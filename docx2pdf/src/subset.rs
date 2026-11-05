// TrueType Font Subsetting for PDF Type 2 CIDFonts.
// Reduces embedded font size by extracting only used glyphs (and composite dependencies)
// while preserving original GID indexing for 100% Identity-H CID compatibility.

use std::collections::{BTreeMap, BTreeSet, HashMap};

struct TableEntry {
    tag: [u8; 4],
    offset: usize,
    length: usize,
}

fn calc_checksum(data: &[u8]) -> u32 {
    let mut sum = 0u32;
    let mut i = 0;
    while i + 4 <= data.len() {
        let val = u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
        sum = sum.wrapping_add(val);
        i += 4;
    }
    if i < data.len() {
        let mut buf = [0u8; 4];
        buf[..data.len() - i].copy_from_slice(&data[i..]);
        let val = u32::from_be_bytes(buf);
        sum = sum.wrapping_add(val);
    }
    sum
}

fn parse_tables(bytes: &[u8]) -> Option<HashMap<[u8; 4], TableEntry>> {
    if bytes.len() < 12 {
        return None;
    }
    let num_tables = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
    if bytes.len() < 12 + num_tables * 16 {
        return None;
    }

    let mut map = HashMap::with_capacity(num_tables);
    for i in 0..num_tables {
        let off = 12 + i * 16;
        let mut tag = [0u8; 4];
        tag.copy_from_slice(&bytes[off..off + 4]);
        let toff = u32::from_be_bytes([bytes[off + 8], bytes[off + 9], bytes[off + 10], bytes[off + 11]]) as usize;
        let tlen = u32::from_be_bytes([bytes[off + 12], bytes[off + 13], bytes[off + 14], bytes[off + 15]]) as usize;
        if toff + tlen <= bytes.len() {
            map.insert(tag, TableEntry { tag, offset: toff, length: tlen });
        }
    }
    Some(map)
}

fn get_glyph_range(
    gid: u16,
    loca_bytes: &[u8],
    index_to_loc_format: i16,
    num_glyphs: usize,
    glyf_len: usize,
) -> Option<(usize, usize)> {
    let g = gid as usize;
    if g >= num_glyphs {
        return None;
    }

    let (off1, off2) = if index_to_loc_format == 0 {
        if (g + 1) * 2 + 2 > loca_bytes.len() {
            return None;
        }
        let o1 = u16::from_be_bytes([loca_bytes[g * 2], loca_bytes[g * 2 + 1]]) as usize * 2;
        let o2 = u16::from_be_bytes([loca_bytes[(g + 1) * 2], loca_bytes[(g + 1) * 2 + 1]]) as usize * 2;
        (o1, o2)
    } else {
        if (g + 1) * 4 + 4 > loca_bytes.len() {
            return None;
        }
        let o1 = u32::from_be_bytes([
            loca_bytes[g * 4],
            loca_bytes[g * 4 + 1],
            loca_bytes[g * 4 + 2],
            loca_bytes[g * 4 + 3],
        ]) as usize;
        let o2 = u32::from_be_bytes([
            loca_bytes[(g + 1) * 4],
            loca_bytes[(g + 1) * 4 + 1],
            loca_bytes[(g + 1) * 4 + 2],
            loca_bytes[(g + 1) * 4 + 3],
        ]) as usize;
        (o1, o2)
    };

    if off1 <= off2 && off2 <= glyf_len {
        Some((off1, off2 - off1))
    } else {
        None
    }
}

fn collect_composite_deps(
    gid: u16,
    glyf_bytes: &[u8],
    loca_bytes: &[u8],
    index_to_loc_format: i16,
    num_glyphs: usize,
    out: &mut BTreeSet<u16>,
) {
    if !out.insert(gid) {
        return;
    }

    if let Some((off, len)) = get_glyph_range(gid, loca_bytes, index_to_loc_format, num_glyphs, glyf_bytes.len()) {
        if len >= 10 {
            let gdata = &glyf_bytes[off..off + len];
            let num_contours = i16::from_be_bytes([gdata[0], gdata[1]]);
            if num_contours < 0 {
                // Composite glyph
                let mut pos = 10;
                loop {
                    if pos + 4 > len {
                        break;
                    }
                    let flags = u16::from_be_bytes([gdata[pos], gdata[pos + 1]]);
                    let comp_gid = u16::from_be_bytes([gdata[pos + 2], gdata[pos + 3]]);
                    collect_composite_deps(comp_gid, glyf_bytes, loca_bytes, index_to_loc_format, num_glyphs, out);

                    pos += 4;
                    if (flags & 0x0001) != 0 {
                        // ARG_1_AND_2_ARE_WORDS
                        pos += 4;
                    } else {
                        pos += 2;
                    }
                    if (flags & 0x0008) != 0 {
                        // WE_HAVE_A_SCALE
                        pos += 2;
                    } else if (flags & 0x0040) != 0 {
                        // WE_HAVE_AN_X_AND_Y_SCALE
                        pos += 4;
                    } else if (flags & 0x0080) != 0 {
                        // WE_HAVE_A_TWO_BY_TWO
                        pos += 8;
                    }
                    if (flags & 0x0020) == 0 {
                        // MORE_COMPONENTS not set
                        break;
                    }
                }
            }
        }
    }
}

fn get_metric(gid: u16, hmtx: &[u8], num_hmetrics: usize) -> (u16, i16) {
    let g = gid as usize;
    if g < num_hmetrics {
        let off = g * 4;
        if off + 4 <= hmtx.len() {
            let adv = u16::from_be_bytes([hmtx[off], hmtx[off + 1]]);
            let lsb = i16::from_be_bytes([hmtx[off + 2], hmtx[off + 3]]);
            return (adv, lsb);
        }
    } else if num_hmetrics > 0 {
        let last_adv_off = (num_hmetrics - 1) * 4;
        let lsb_off = num_hmetrics * 4 + (g - num_hmetrics) * 2;
        let adv = if last_adv_off + 2 <= hmtx.len() {
            u16::from_be_bytes([hmtx[last_adv_off], hmtx[last_adv_off + 1]])
        } else {
            0
        };
        let lsb = if lsb_off + 2 <= hmtx.len() {
            i16::from_be_bytes([hmtx[lsb_off], hmtx[lsb_off + 1]])
        } else {
            0
        };
        return (adv, lsb);
    }
    (0, 0)
}

pub fn subset_ttf(font_bytes: &[u8], used_gids: &BTreeMap<u16, char>) -> Vec<u8> {
    if used_gids.is_empty() {
        return font_bytes.to_vec();
    }

    let tables = match parse_tables(font_bytes) {
        Some(t) => t,
        None => return font_bytes.to_vec(),
    };

    let head_entry = match tables.get(b"head") { Some(e) => e, None => return font_bytes.to_vec() };
    let hhea_entry = match tables.get(b"hhea") { Some(e) => e, None => return font_bytes.to_vec() };
    let maxp_entry = match tables.get(b"maxp") { Some(e) => e, None => return font_bytes.to_vec() };
    let loca_entry = match tables.get(b"loca") { Some(e) => e, None => return font_bytes.to_vec() };
    let glyf_entry = match tables.get(b"glyf") { Some(e) => e, None => return font_bytes.to_vec() };
    let hmtx_entry = match tables.get(b"hmtx") { Some(e) => e, None => return font_bytes.to_vec() };

    let head_bytes = &font_bytes[head_entry.offset..head_entry.offset + head_entry.length];
    let hhea_bytes = &font_bytes[hhea_entry.offset..hhea_entry.offset + hhea_entry.length];
    let maxp_bytes = &font_bytes[maxp_entry.offset..maxp_entry.offset + maxp_entry.length];
    let loca_bytes = &font_bytes[loca_entry.offset..loca_entry.offset + loca_entry.length];
    let glyf_bytes = &font_bytes[glyf_entry.offset..glyf_entry.offset + glyf_entry.length];
    let hmtx_bytes = &font_bytes[hmtx_entry.offset..hmtx_entry.offset + hmtx_entry.length];

    if head_bytes.len() < 54 || hhea_bytes.len() < 36 || maxp_bytes.len() < 6 {
        return font_bytes.to_vec();
    }

    let index_to_loc_format = i16::from_be_bytes([head_bytes[50], head_bytes[51]]);
    let orig_num_glyphs = u16::from_be_bytes([maxp_bytes[4], maxp_bytes[5]]) as usize;
    let orig_num_hmetrics = u16::from_be_bytes([hhea_bytes[34], hhea_bytes[35]]) as usize;

    // Collect all needed GIDs including composite dependencies
    let mut needed_gids = BTreeSet::new();
    needed_gids.insert(0); // .notdef must always be present
    for &gid in used_gids.keys() {
        collect_composite_deps(gid, glyf_bytes, loca_bytes, index_to_loc_format, orig_num_glyphs, &mut needed_gids);
    }

    let max_gid = match needed_gids.iter().max() {
        Some(&m) => m,
        None => 0,
    };
    let subset_num_glyphs = (max_gid as usize) + 1;

    // 1. Build new 'glyf' and 32-bit 'loca'
    let mut new_glyf = Vec::new();
    let mut new_loca_offsets: Vec<u32> = Vec::with_capacity(subset_num_glyphs + 1);

    for gid in 0..=max_gid {
        new_loca_offsets.push(new_glyf.len() as u32);
        if needed_gids.contains(&gid) {
            if let Some((off, len)) = get_glyph_range(gid, loca_bytes, index_to_loc_format, orig_num_glyphs, glyf_bytes.len()) {
                if len > 0 {
                    new_glyf.extend_from_slice(&glyf_bytes[off..off + len]);
                    // Pad glyph data to 4-byte boundary
                    while new_glyf.len() % 4 != 0 {
                        new_glyf.push(0);
                    }
                }
            }
        }
    }
    new_loca_offsets.push(new_glyf.len() as u32);

    let mut new_loca = Vec::with_capacity(new_loca_offsets.len() * 4);
    for off in new_loca_offsets {
        new_loca.extend_from_slice(&off.to_be_bytes());
    }

    // 2. Build new 'head' (indexToLocFormat = 1 for 32-bit loca)
    let mut new_head = head_bytes.to_vec();
    new_head[8..12].fill(0); // checkSumAdjustment = 0
    new_head[50..52].copy_from_slice(&1i16.to_be_bytes());

    // 3. Build new 'maxp' (numGlyphs = subset_num_glyphs)
    let mut new_maxp = maxp_bytes.to_vec();
    new_maxp[4..6].copy_from_slice(&(subset_num_glyphs as u16).to_be_bytes());

    // 4. Build new 'hmtx' and 'hhea'
    let mut new_hmtx = Vec::with_capacity(subset_num_glyphs * 4);
    for gid in 0..=max_gid {
        let (adv, lsb) = get_metric(gid, hmtx_bytes, orig_num_hmetrics);
        new_hmtx.extend_from_slice(&adv.to_be_bytes());
        new_hmtx.extend_from_slice(&lsb.to_be_bytes());
    }

    let mut new_hhea = hhea_bytes.to_vec();
    new_hhea[34..36].copy_from_slice(&(subset_num_glyphs as u16).to_be_bytes());

    // 5. Gather tables
    let mut out_tables: Vec<([u8; 4], Vec<u8>)> = vec![
        (*b"glyf", new_glyf),
        (*b"head", new_head),
        (*b"hhea", new_hhea),
        (*b"hmtx", new_hmtx),
        (*b"loca", new_loca),
        (*b"maxp", new_maxp),
    ];

    // Preserve optional metadata tables if present
    for tag in [b"OS/2", b"cmap", b"name"] {
        if let Some(entry) = tables.get(tag) {
            let data = font_bytes[entry.offset..entry.offset + entry.length].to_vec();
            out_tables.push((*tag, data));
        }
    }

    // Include minimal PostScript table (format 3.0: 32 bytes header without glyph names)
    if let Some(entry) = tables.get(b"post") {
        let pbytes = &font_bytes[entry.offset..entry.offset + entry.length];
        if pbytes.len() >= 32 {
            let mut post3 = pbytes[..32].to_vec();
            post3[0..4].copy_from_slice(&[0x00, 0x03, 0x00, 0x00]); // format 3.0
            out_tables.push((*b"post", post3));
        }
    }

    // Sort tables alphabetically by tag (mandatory per OpenType spec)
    out_tables.sort_by(|a, b| a.0.cmp(&b.0));

    // Calculate directory headers
    let num_tables = out_tables.len() as u16;
    let mut p = 1u16;
    let mut entry_selector = 0u16;
    while (p << 1) <= num_tables {
        p <<= 1;
        entry_selector += 1;
    }
    let search_range = p * 16;
    let range_shift = num_tables * 16 - search_range;

    let mut result = Vec::new();
    // OffsetTable (12 bytes)
    result.extend_from_slice(&0x00010000u32.to_be_bytes());
    result.extend_from_slice(&num_tables.to_be_bytes());
    result.extend_from_slice(&search_range.to_be_bytes());
    result.extend_from_slice(&entry_selector.to_be_bytes());
    result.extend_from_slice(&range_shift.to_be_bytes());

    let header_size = 12 + out_tables.len() * 16;
    let mut current_offset = header_size;
    let mut head_table_offset = 0;

    // Write table directory entries
    for (tag, data) in &out_tables {
        let checksum = calc_checksum(data);
        result.extend_from_slice(tag);
        result.extend_from_slice(&checksum.to_be_bytes());
        result.extend_from_slice(&(current_offset as u32).to_be_bytes());
        result.extend_from_slice(&(data.len() as u32).to_be_bytes());

        if tag == b"head" {
            head_table_offset = current_offset;
        }

        // Align each table to 4 bytes
        let padded_len = (data.len() + 3) & !3;
        current_offset += padded_len;
    }

    // Write table bodies
    for (_tag, data) in &out_tables {
        result.extend_from_slice(data);
        while result.len() % 4 != 0 {
            result.push(0);
        }
    }

    // Compute font checkSumAdjustment
    if head_table_offset > 0 && head_table_offset + 12 <= result.len() {
        let full_checksum = calc_checksum(&result);
        let adjustment = 0xB1B0AFBA_u32.wrapping_sub(full_checksum);
        result[head_table_offset + 8..head_table_offset + 12].copy_from_slice(&adjustment.to_be_bytes());
    }

    result
}
