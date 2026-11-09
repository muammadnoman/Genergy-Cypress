module.exports = [
  { ignores: ['node_modules/**', 'cypress/reports/**', '.qa-runs/**'] },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
  {
    files: ['cypress/e2e/**/*.cy.js'],
    plugins: {
      pom: { rules: {
        'no-ui-in-specs': {
          meta: { type: 'problem', schema: [] },
          create(context) {
            const commands = new Set(['get', 'contains', 'find', 'closest', 'parent', 'parents', 'children', 'within', 'root', 'shadow', 'visit', 'url', 'location', 'window', 'document', 'click', 'dblclick', 'rightclick', 'type', 'clear', 'select', 'check', 'uncheck', 'focus', 'blur', 'trigger', 'selectFile', 'scrollIntoView', 'scrollTo', 'invoke']);
            return {
              CallExpression(node) {
                if (node.callee.type !== 'MemberExpression') return;
                const name = node.callee.computed ? node.callee.property.value : node.callee.property.name;
                if (name === 'only' && ['it', 'describe', 'context', 'specify'].includes(node.callee.object.name)) {
                  context.report({ node, message: 'Remove focused tests before committing: CI must execute the selected suite.' });
                }
                if (!commands.has(name)) return;
                if (name === 'get' && node.arguments[0]?.type === 'Literal' && String(node.arguments[0].value).startsWith('@')) return;
                if (node.callee.object.type === 'Identifier' && node.callee.object.name !== 'cy') return;
                context.report({ node, message: 'Keep UI selectors/actions/assertions in a page class. Specs call POM methods.' });
              },
            };
          },
        },
      } },
    },
    rules: { 'pom/no-ui-in-specs': 'error' },
  },
  {
    files: ['cypress/e2e/**/*.cy.js'],
    ignores: ['cypress/e2e/API_TESTS/**'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'CallExpression[callee.name="expect"]', message: 'Keep UI-scenario assertions in the existing page class.' },
        { selector: 'CallExpression[callee.object.name="assert"]', message: 'Keep UI-scenario assertions in the existing page class.' },
        { selector: 'CallExpression[callee.property.name=/^(should|and)$/]', message: 'Keep UI-scenario assertions in the existing page class.' },
        { selector: 'CallExpression[callee.object.name="cy"][callee.property.name=/^(task|intercept|wait|request|verifyToast)$/]', message: 'Keep UI-scenario setup, network waits and validation in the existing page class.' },
      ],
    },
  },
];
