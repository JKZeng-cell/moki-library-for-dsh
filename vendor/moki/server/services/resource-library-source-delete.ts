import { lstat, realpath, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ResourceLibraryItem } from "../../shared/resource-library-contract.js";

// Delete the mapped entry itself; never follow a file symlink or directory junction.
export async function deleteResourceLibrarySource(item: ResourceLibraryItem): Promise<void> {
  if (!item.target || !["local_file", "local_folder"].includes(item.kind) || !isAbsolute(item.target)) {
    throw new Error("只有具有绝对路径的本地文件或文件夹可以彻底删除");
  }
  const target = resolve(item.target);
  if (dirname(target) === target) throw new Error("不能彻底删除磁盘或共享根目录");
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    await unlink(target);
    return;
  }
  const canonical = await realpath(target);
  if (dirname(canonical) === canonical) throw new Error("不能彻底删除磁盘或共享根目录");
  if (item.kind === "local_file" && !metadata.isFile()) throw new Error("源文件类型已改变，请重新查看后确认");
  if (item.kind === "local_folder" && !metadata.isDirectory()) throw new Error("源文件夹类型已改变，请重新查看后确认");
  await rm(target, { recursive: item.kind === "local_folder", force: false });
}
