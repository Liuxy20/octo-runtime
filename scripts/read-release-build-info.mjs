import { execFileSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

export function readReleaseBuildInfo(archive, packageName = "@mininglamp-oss/octo-runtime") {
  const filename = resolve(archive);
  return JSON.parse(
    execFileSync(
      "tar",
      [
        "-xOf",
        basename(filename),
        packageName === "@mininglamp-oss/octo-runtime-client"
          ? "package/build-info.json"
          : "package/apps/cli/dist/build-info.json"
      ],
      {
        cwd: dirname(filename),
        encoding: "utf8"
      }
    )
  );
}
