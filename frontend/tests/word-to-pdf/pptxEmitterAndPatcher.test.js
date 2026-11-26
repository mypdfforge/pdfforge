import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Kind, makeNode, createScene, finalizeScene } from '../../src/utils/pptx/sceneGraph.js';
import { emitScenes } from '../../src/utils/pptx/slideEmitter.js';
import { validateSlideXml, patchOoxml } from '../../src/utils/pptx/ooxmlPatcher.js';
import { computeSsim, evaluateFidelity } from '../../src/utils/pptx/fidelityGuard.js';

describe('PR 4: slideEmitter, ooxmlPatcher, fidelityGuard', () => {
  it('emits scenes in strict z-order and patches OOXML invariants (insets, noAutofit, baseline, ghost alpha)', async () => {
    const scene = createScene(0, { w: 10, h: 7.5 });

    // Background shape at z=1
    scene.nodes.push(
      makeNode(Kind.SHAPE, 1, { x: 0.5, y: 0.5, w: 9, h: 1.2 }, {
        shapeType: 'rect',
        fill: 'E2E8F0',
        fillAlpha: 1,
      })
    );

    // Native text with superscript baseline, char spacing, and line spacing at z=2
    scene.nodes.push(
      makeNode(Kind.TEXT, 2, { x: 0.75, y: 0.75, w: 4, h: 0.5 }, {
        lineSpacingPt: 14,
        wrap: 'none',
        runs: [
          { text: 'E = mc', fontSizePt: 14, color: '0F172A' },
          { text: '2', fontSizePt: 10, color: '0F172A', baseline: 'super', charSpacingPt: 0.5 },
        ],
      })
    );

    // Ghost text (selectable invisible text over raster) at z=3
    scene.nodes.push(
      makeNode(Kind.TEXT, 3, { x: 1, y: 2, w: 3, h: 0.4 }, {
        ghost: true,
        runs: [{ text: 'Hidden OCR Layer', fontSizePt: 12, color: '000000' }],
      })
    );

    // RTL text at z=4
    scene.nodes.push(
      makeNode(Kind.TEXT, 4, { x: 5, y: 2, w: 3, h: 0.4 }, {
        dir: 'rtl',
        runs: [{ text: 'مرحبا', fontSizePt: 14, color: '111111' }],
      })
    );

    // Table with border & merge patch at z=5
    scene.nodes.push(
      makeNode(Kind.TABLE, 5, { x: 1, y: 3, w: 6, h: 1.5 }, {
        colWidths: [3, 3],
        rows: [
          {
            cells: [
              {
                text: 'Header',
                bold: true,
                borders: { bottom: { widthPt: 1.5, color: '1E293B' } },
              },
              { text: 'Value' },
            ],
          },
          {
            cells: [{ text: 'Row 1' }, { text: '42' }],
          },
        ],
      })
    );

    finalizeScene(scene);

    const blob = await emitScenes([scene]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1000);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slide1Xml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(slide1Xml).toBeDefined();

    const validation = validateSlideXml(slide1Xml);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    // Zero insets & noAutofit & wrap="none"
    expect(slide1Xml).toContain('lIns="0"');
    expect(slide1Xml).toContain('tIns="0"');
    expect(slide1Xml).toContain('rIns="0"');
    expect(slide1Xml).toContain('bIns="0"');
    expect(slide1Xml).toContain('<a:noAutofit/>');
    expect(slide1Xml).toContain('wrap="none"');

    // Line spacing, superscript baseline, char spacing, ghost alpha="0", RTL
    expect(slide1Xml).toContain('<a:lnSpc><a:spcPts val="1400"/></a:lnSpc>');
    expect(slide1Xml).toContain('baseline="30000"');
    expect(slide1Xml).toContain('spc="50"');
    expect(slide1Xml).toContain('<a:alpha val="0"/>');
    expect(slide1Xml).toContain('rtl="1"');
    expect(slide1Xml).toContain('algn="r"');
    expect(slide1Xml).toContain('<a:lnB');
  });

  it('detects invalid OOXML in validateSlideXml and deduplicates identical media in patchOoxml', async () => {
    const badXml = `
      <p:sld><p:cSld><p:spTree>
        <p:sp><p:txBody><a:bodyPr/><a:p><a:pPr/><a:pPr/></a:p></p:txBody></p:sp>
        <a:off x="NaN" y="0"/>
      </p:spTree></p:cSld></p:sld>
    `;
    const res = validateSlideXml(badXml);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);

    // Media deduplication check
    const zip = new JSZip();
    const imgBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    zip.file('ppt/media/image1.png', imgBytes);
    zip.file('ppt/media/image2.png', imgBytes);
    zip.file(
      'ppt/slides/slide1.xml',
      '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>ok</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    );
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="../media/image2.png"/></Relationships>'
    );

    const patchedBlob = await patchOoxml(await zip.generateAsync({ type: 'arraybuffer' }));
    const outZip = await JSZip.loadAsync(await patchedBlob.arrayBuffer());
    expect(outZip.file('ppt/media/image1.png')).not.toBeNull();
    expect(outZip.file('ppt/media/image2.png')).toBeNull();
    const rels = await outZip.file('ppt/slides/_rels/slide1.xml.rels').async('string');
    expect(rels).toContain('../media/image1.png');
    expect(rels).not.toContain('../media/image2.png');
  });

  it('computes SSIM and evaluates fidelity thresholds (ok, repair, fallback-t3)', () => {
    const w = 32;
    const h = 32;
    const ref = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < ref.length; i += 4) {
      ref[i] = 120;
      ref[i + 1] = 160;
      ref[i + 2] = 200;
      ref[i + 3] = 255;
    }

    expect(computeSsim(ref, ref, w, h)).toBeCloseTo(1, 5);
    const ok = evaluateFidelity(ref, ref, w, h);
    expect(ok.passed).toBe(true);
    expect(ok.action).toBe('ok');

    // Slight perturbation in one 8x8 block (out of 16) -> high SSIM (>0.94) but diffRatio > 0.01 -> repair
    const slight = new Uint8ClampedArray(ref);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 8; x++) {
        const idx = (y * w + x) * 4;
        slight[idx] = 155;
        slight[idx + 1] = 195;
        slight[idx + 2] = 235;
      }
    }
    const repair = evaluateFidelity(ref, slight, w, h, { ssimTarget: 0.985, diffFailRatio: 0.01 });
    expect(repair.passed).toBe(false);
    expect(repair.action).toBe('repair');

    // Completely inverted -> fallback-t3
    const inverted = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < inverted.length; i += 4) {
      inverted[i] = 0;
      inverted[i + 1] = 0;
      inverted[i + 2] = 0;
      inverted[i + 3] = 255;
    }
    const fail = evaluateFidelity(ref, inverted, w, h);
    expect(fail.passed).toBe(false);
    expect(fail.action).toBe('fallback-t3');
  });
});
