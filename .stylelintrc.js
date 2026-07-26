module.exports = {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['**/node_modules/**', '**/dist/**'],
  rules: {
    'no-empty-source': null,
    // 插件模块 CSS 使用 BEM（__element、--modifier）与模块前缀，放宽 kebab-case 限制
    'selector-class-pattern': [
      '^([a-z][a-z0-9-_]+)$',
      {
        message: (selector) =>
          `Expected class selector "${selector}" to use lowercase letters, numbers, hyphens and underscores`,
      },
    ],
    // 允许 min-width/max-width 等传统媒体查询写法
    'media-feature-range-notation': null,
    // 不强制规则块之间空行
    'rule-empty-line-before': null,
    // 不强制注释前空行（保护区标记、文件头指针等）
    'comment-empty-line-before': null,
    // CR-001：border-radius 仅允许 3px / 10px / 50% / 0（允许多角简写）
    'declaration-property-value-allowed-list': {
      'border-radius': [
        '0',
        '3px',
        '10px',
        '50%',
        '/^(0|3px|10px|50%)( (0|3px|10px|50%)){0,3}$/',
      ],
    },
  },
}
