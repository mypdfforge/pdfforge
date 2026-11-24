import { LevelFormat, AlignmentType } from 'docx';

export function createNumberingConfig(defs: { id: string; kind?: string; levels?: any[] }[] = []) {
  const mk = (ref: string, kind: 'bullet' | 'number') => ({
    reference: ref,
    levels: Array.from({ length: 9 }, (_, i) => ({
      level: i,
      format: kind === 'bullet' ? LevelFormat.BULLET : LevelFormat.DECIMAL,
      text: kind === 'bullet' ? ['•', '◦', '▪'][i % 3]
           : Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join('.') + '.',
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: (i + 1) * 360, hanging: 360 } } },
    })),
  });

  return {
    config: defs && defs.length
      ? defs.map((d) => mk(d.id, (d.kind || 'number') as any))
      : [mk('bullet-list', 'bullet'), mk('number-list', 'number')],
  };
}
