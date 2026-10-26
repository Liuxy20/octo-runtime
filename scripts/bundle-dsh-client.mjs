import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const dshAdapterName = "@mininglamp-oss/octo-runtime-adapter-dsh";
export const dshClientName = "@deepseek-ai/dsh-sdk-client";

/** 发行包只收集官方客户端的实际 JS import；运行时由宿主显式选择，不随包交付 Provider。 */
export async function bundleDshClient(source, target) {
  const require = createRequire(join(source, "package.json"));
  const clientManifest = JSON.parse(
    await readFile(require.resolve(`${dshClientName}/package.json`), "utf8")
  );
  const protocolName = "@deepseek-ai/dsh-sdk-protocol";
  const clientRequire = createRequire(require.resolve(`${dshClientName}/package.json`));
  const protocolManifestPath = clientRequire.resolve(`${protocolName}/package.json`);
  const protocolManifest = JSON.parse(await readFile(protocolManifestPath, "utf8"));
  const result = await build({
    entryPoints: ["index", "errors", "launch", "trajectory"].map((name) =>
      join(source, "dist", `${name}.js`)
    ),
    outdir: join(target, "dist"),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node24",
    packages: "external",
    metafile: true,
    legalComments: "eof",
    plugins: [
      {
        name: "official-dsh-client",
        setup(build) {
          build.onResolve({ filter: /^@deepseek-ai\/dsh-sdk-(client|protocol)$/ }, (args) => {
            const from = args.importer ? createRequire(args.importer) : require;
            return { path: from.resolve(args.path) };
          });
        }
      }
    ]
  });
  const inputs = Object.keys(result.metafile.inputs);
  const officialEntries = [require.resolve(dshClientName), clientRequire.resolve(protocolName)];
  if (!officialEntries.every((entry) => inputs.some((path) => resolve(path) === entry)))
    throw new Error("Official DSH client and protocol must be present in the release bundle");
  if (inputs.some((path) => path.replaceAll("\\", "/").includes("/@deepseek-ai/dsh/")))
    throw new Error("The DSH Provider must remain outside the Runtime release bundle");
  await writeFile(
    join(target, "dist", "dsh-sdk-NOTICE.txt"),
    `${dshClientName}@${clientManifest.version}\n` +
      `${protocolName}@${protocolManifest.version}\n` +
      `License: ${clientManifest.license}\n` +
      `Upstream: https://github.com/deepseek-ai/deepseek-harness\n` +
      `Unmodified official npm JavaScript is bundled by esbuild.\n` +
      `DSH integration is experimental; SDK process-tree cleanup and pre-parse resource limits are not guaranteed.\n`
  );
  for (const [name, manifest] of [
    ["client", require.resolve(`${dshClientName}/package.json`)],
    ["protocol", protocolManifestPath]
  ])
    await writeFile(
      join(target, "dist", `dsh-sdk-${name}-LICENSE.txt`),
      await readFile(join(dirname(manifest), "LICENSE"), "utf8")
    );
  return result.metafile;
}
