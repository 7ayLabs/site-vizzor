/**
 * Fumadocs source config — defines the MDX collection (`content/docs/`)
 * and wires KaTeX math support through remark-math + rehype-katex.
 *
 * `mdxOptions.rehypePlugins` and `remarkPlugins` accept a function form
 * (`ResolvePlugins`) that receives Fumadocs' default plugin list. We need
 * rehype-katex to run BEFORE rehype-code (Shiki) so math nodes are turned
 * into rendered HTML and never reach the syntax highlighter — otherwise
 * Shiki throws `Language "math" is not included in this bundle`.
 *
 * The `fumadocs-mdx` CLI reads this file and emits the `.source/` directory
 * that `lib/source.ts` consumes at runtime.
 */
import { defineDocs, defineConfig } from 'fumadocs-mdx/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [remarkMath, ...plugins],
    // strict:false + throwOnError:false keep KaTeX from breaking the build on
    // syntactically borderline math; mathml stays for accessibility.
    rehypePlugins: (plugins) => [
      [rehypeKatex, { strict: false, throwOnError: false }],
      ...plugins,
    ],
  },
});
