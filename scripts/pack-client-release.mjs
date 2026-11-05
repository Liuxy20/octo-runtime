import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parseNpmPackResult } from "./parse-npm-pack-result.mjs";

export const clientPackageName = "@mininglamp-oss/octo-runtime-client";
export const protocolPackageName = "@mininglamp-oss/octo-runtime-protocol";

/** 同一构建/版本打包轻量客户端；仅收集唯一共享协议，不包含服务端依赖。 */
export async function packClientRelease({ root, releaseVersion, output, npm }) {
  const temporary = await mkdtemp(join(tmpdir(), "octo-client-release-"));
  try {
    const source = join(root, "packages/octo-runtime-client");
    const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    if (manifest.version !== "0.0.0") throw new Error("Client source version must remain 0.0.0");
    await cp(join(source, "dist"), join(temporary, "dist"), { recursive: true });
    await cp(join(source, "README.md"), join(temporary, "README.md"));
    await cp(join(root, "LICENSE"), join(temporary, "LICENSE"));
    await cp(join(root, "apps/cli/dist/build-info.json"), join(temporary, "build-info.json"));
    const protocolSource = join(root, "packages/octo-runtime-protocol");
    const protocolTarget = join(temporary, "node_modules", protocolPackageName);
    await mkdir(protocolTarget, { recursive: true });
    await cp(join(protocolSource, "dist"), join(protocolTarget, "dist"), { recursive: true });
    await cp(join(protocolSource, "schema"), join(temporary, "schema"), { recursive: true });
    const protocol = JSON.parse(await readFile(join(protocolSource, "package.json"), "utf8"));
    if (Object.keys(protocol.dependencies ?? {}).length)
      throw new Error("Review new protocol runtime dependencies before packing the client");
    const { scripts: _protocolScripts, devDependencies: _dev, ...protocolMetadata } = protocol;
    await writeFile(
      join(protocolTarget, "package.json"),
      JSON.stringify({ ...protocolMetadata, version: releaseVersion }, null, 2) + "\n"
    );
    const { scripts: _scripts, ...metadata } = manifest;
    await writeFile(
      join(temporary, "package.json"),
      JSON.stringify(
        {
          ...metadata,
          version: releaseVersion,
          dependencies: { [protocolPackageName]: releaseVersion },
          bundleDependencies: [protocolPackageName]
        },
        null,
        2
      ) + "\n"
    );
    const result = parseNpmPackResult(
      execFileSync(
        process.execPath,
        [npm, "pack", "--json", "--ignore-scripts", "--pack-destination", output],
        { cwd: temporary, encoding: "utf8" }
      ),
      clientPackageName
    );
    if (result.bundled.length !== 1 || result.bundled[0] !== protocolPackageName)
      throw new Error("Client must bundle only the shared protocol");
    return join(output, result.filename);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
