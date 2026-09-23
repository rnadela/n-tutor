import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.seed/**', 'src/generated/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
