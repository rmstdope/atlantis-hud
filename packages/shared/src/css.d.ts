// TypeScript 6 checks side-effect imports by default (noUncheckedSideEffectImports);
// the bundler resolves stylesheet imports such as the @fontsource faces.
declare module "*.css";
