/// <reference types="vite/client" />

/** esbuild 将 .css 作为 text 打进 content 脚本时使用 */
declare module '*.css' {
  const content: string;
  export default content;
}
