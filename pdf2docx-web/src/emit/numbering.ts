import { LevelFormat, AlignmentType } from 'docx';

export function createNumberingConfig() {
  const bulletLevels = Array.from({ length: 9 }, (_, i) => ({
    level: i,
    format: LevelFormat.BULLET,
    text: '•',
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: { left: (i + 1) * 720, hanging: 360 }, // 720 twips = 0.5 in
      },
    },
  }));

  const decimalLevels = Array.from({ length: 9 }, (_, i) => ({
    level: i,
    format: LevelFormat.DECIMAL,
    text: `%${i + 1}.`,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: { left: (i + 1) * 720, hanging: 360 },
      },
    },
  }));

  return {
    config: [
      {
        reference: 'bullet-list',
        levels: bulletLevels,
      },
      {
        reference: 'number-list',
        levels: decimalLevels,
      },
    ],
  };
}
