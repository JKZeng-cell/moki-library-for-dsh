import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { normalize } from "node:path";
import type { WorkbenchDatabase } from "../db/database.js";
import type {
  ResourceLibraryCreate,
  ResourceLibraryItem,
  ResourceLibraryUpdate,
} from "../../shared/resource-library-contract.js";

type Row = {
  id: string;
  parent_id: string | null;
  kind: ResourceLibraryItem["kind"];
  name: string;
  target: string | null;
  tags_json: string;
  folder_color: ResourceLibraryItem["folderColor"];
  assistant_permission: ResourceLibraryItem["assistantPermission"];
  sort_order: number;
  file_created_at: string | null;
  file_modified_at: string | null;
  thumbnail_data_url: string | null;
  has_thumbnail?: number;
  created_at: string;
  updated_at: string;
};

export type ResourceLibraryFolderTreeNode = {
  kind: "local_file" | "local_folder";
  name: string;
  target: string;
  children?: ResourceLibraryFolderTreeNode[];
};

export type ResourceLibraryIndexedEntry = {
  kind: "local_file" | "local_folder";
  name: string;
  target: string;
  parentTarget: string | null;
  fileCreatedAt: string | null;
  fileModifiedAt: string | null;
};

type ResourceLibraryCreateInput = ResourceLibraryCreate & {
  fileCreatedAt?: string | null;
  fileModifiedAt?: string | null;
};

type ResourceLibraryUpdateInput = ResourceLibraryUpdate & {
  fileModifiedAt?: string | null;
};

function mapRow(row: Row): ResourceLibraryItem {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json) as unknown;
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: row.kind,
    name: row.name,
    target: row.target,
    tags,
    folderColor: row.folder_color ?? null,
    assistantPermission: row.assistant_permission ?? null,
    sortOrder: row.sort_order,
    fileCreatedAt: row.file_created_at,
    fileModifiedAt: row.file_modified_at,
    thumbnailDataUrl: row.thumbnail_data_url,
    ...(row.has_thumbnail ? { hasThumbnail: true } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function localTargetKey(target: string): string {
  const normalized = normalize(target);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function childTags(tags: string[]): string[] {
  return tags.filter((tag) => !tag.startsWith("moki-system-directory:")
    && tag !== "moki-task-space"
    && !tag.startsWith("moki-task-space-source:")
    && !tag.startsWith("moki-task-space-dedicated-session:")
    && !tag.startsWith("moki-task-folder-session:"));
}

export class ResourceLibraryRepository {
  constructor(
    private readonly db: WorkbenchDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list({ parentId, thumbnails = "inline" }: {
    parentId?: string | null;
    thumbnails?: "inline" | "deferred" | "omit";
  } = {}): ResourceLibraryItem[] {
    // Canvas generates WebP or PNG. Preserve other legacy thumbnail formats inline.
    const raster = "(thumbnail_data_url GLOB 'data:image/webp;base64,*' OR thumbnail_data_url GLOB 'data:image/png;base64,*')";
    const thumbnailColumns = thumbnails === "deferred"
      ? `${raster} AS has_thumbnail, CASE WHEN ${raster} THEN NULL ELSE thumbnail_data_url END AS thumbnail_data_url`
      : thumbnails === "omit" ? "NULL AS thumbnail_data_url" : "thumbnail_data_url";
    return (this.db.prepare(`
      SELECT id, parent_id, kind, name, target, tags_json, folder_color, assistant_permission, sort_order, file_created_at, file_modified_at, ${thumbnailColumns}, created_at, updated_at
      FROM resource_library_items
      ${parentId === undefined ? "" : "WHERE parent_id IS ?"}
      ORDER BY parent_id, sort_order,
               CASE kind WHEN 'folder' THEN 0 WHEN 'local_folder' THEN 1 ELSE 2 END,
               name COLLATE NOCASE, created_at
    `).all(...(parentId === undefined ? [] : [parentId])) as unknown as Row[]).map(mapRow);
  }

  find(id: string): ResourceLibraryItem | undefined {
    const row = this.db.prepare(`
      SELECT id, parent_id, kind, name, target, tags_json, folder_color, assistant_permission, sort_order, file_created_at, file_modified_at, thumbnail_data_url, created_at, updated_at
      FROM resource_library_items WHERE id = ?
    `).get(id) as Row | undefined;
    return row ? mapRow(row) : undefined;
  }

  create(input: ResourceLibraryCreateInput): ResourceLibraryItem {
    this.assertParent(input.parentId ?? null);
    const timestamp = this.now().toISOString();
    const sortOrder = this.nextSortOrder(input.parentId ?? null);
    const item: ResourceLibraryItem = {
      id: randomUUID(),
      parentId: input.parentId ?? null,
      kind: input.kind,
      name: input.name,
      target: input.kind === "folder" ? null : input.target ?? null,
      tags: input.tags,
      folderColor: input.kind === "folder" || input.kind === "local_folder" ? input.folderColor ?? null : null,
      assistantPermission: input.kind === "local_folder" ? input.assistantPermission ?? null : null,
      sortOrder,
      fileCreatedAt: input.fileCreatedAt ?? null,
      fileModifiedAt: input.fileModifiedAt ?? null,
      thumbnailDataUrl: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.prepare(`
      INSERT INTO resource_library_items(id, parent_id, kind, name, target, tags_json, folder_color, assistant_permission, sort_order, file_created_at, file_modified_at, thumbnail_data_url, created_at, updated_at)
      VALUES ($id, $parentId, $kind, $name, $target, $tags, $folderColor, $assistantPermission, $sortOrder, $fileCreatedAt, $fileModifiedAt, $thumbnailDataUrl, $createdAt, $updatedAt)
    `).run({
      $id: item.id,
      $parentId: item.parentId,
      $kind: item.kind,
      $name: item.name,
      $target: item.target,
      $tags: JSON.stringify(item.tags),
      $folderColor: item.folderColor ?? null,
      $assistantPermission: item.assistantPermission ?? null,
      $sortOrder: item.sortOrder ?? 0,
      $fileCreatedAt: item.fileCreatedAt ?? null,
      $fileModifiedAt: item.fileModifiedAt ?? null,
      $thumbnailDataUrl: item.thumbnailDataUrl ?? null,
      $createdAt: item.createdAt,
      $updatedAt: item.updatedAt,
    });
    if (item.parentId && item.target && (item.kind === "local_file" || item.kind === "local_folder")) {
      this.clearLocalFolderExclusion(item.parentId, item.target);
    }
    return item;
  }

  createLocalFolderTree(
    input: ResourceLibraryCreate & { kind: "local_folder" },
    children: ResourceLibraryFolderTreeNode[],
  ): ResourceLibraryItem {
    this.db.exec("BEGIN");
    try {
      const root = this.create(input);
      const createChildren = (parentId: string, nodes: ResourceLibraryFolderTreeNode[]) => {
        for (const node of nodes) {
          const item = this.create({
            parentId,
            kind: node.kind,
            name: node.name,
            target: node.target,
            tags: childTags(input.tags),
          });
          if (node.kind === "local_folder" && node.children?.length) {
            createChildren(item.id, node.children);
          }
        }
      };
      createChildren(root.id, children);
      this.db.exec("COMMIT");
      return root;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listDescendants(id: string): ResourceLibraryItem[] {
    const ids = this.descendantIds(id);
    return this.list().filter((item) => ids.has(item.id));
  }

  removeLocalFolderDescendantsExcept(rootId: string, keepIds: Set<string>): number {
    const descendants = this.listDescendants(rootId).filter((item) =>
      (item.kind === "local_file" || item.kind === "local_folder") && !keepIds.has(item.id));
    if (!descendants.length) return 0;
    const remove = this.db.prepare("DELETE FROM resource_library_items WHERE id = ?");
    const ordered = [...descendants].sort((left, right) => {
      const leftDepth = this.depth(left.id, descendants);
      const rightDepth = this.depth(right.id, descendants);
      return rightDepth - leftDepth;
    });
    this.db.exec("BEGIN");
    try {
      for (const item of ordered) remove.run(item.id);
      this.db.exec("COMMIT");
      return ordered.length;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  synchronizeLocalFolderLevel(
    root: ResourceLibraryItem,
    entries: ResourceLibraryIndexedEntry[],
    onProgress?: (processed: number, added: number, updated: number) => void,
  ): { added: number; updated: number; removed: number } {
    const timestamp = this.now().toISOString();
    const excludedTargets = this.listLocalFolderExclusionTargets(root.id);
    const includedEntries = entries.filter((entry) => !excludedTargets.has(localTargetKey(entry.target)));
    const directChildren = this.list({ parentId: root.id, thumbnails: "omit" })
      .filter((item) => item.kind === "local_file" || item.kind === "local_folder");
    const existingByTarget = new Map(directChildren.filter((item) => item.target).map((item) => [item.target!, item]));
    const inheritedTags = childTags(root.tags);
    const seenIds = new Set<string>();
    const insert = this.db.prepare(`
      INSERT INTO resource_library_items(id, parent_id, kind, name, target, tags_json, sort_order, file_created_at, file_modified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const update = this.db.prepare(`
      UPDATE resource_library_items
      SET parent_id = ?, kind = ?, name = ?, target = ?, tags_json = ?, sort_order = ?, file_created_at = ?, file_modified_at = ?, updated_at = ?
      WHERE id = ?
    `);
    const remove = this.db.prepare("DELETE FROM resource_library_items WHERE id = ?");
    let added = 0;
    let updated = 0;
    this.db.exec("BEGIN");
    try {
      includedEntries.forEach((entry, index) => {
        const parentId = root.id;
        const order = index;
        const current = existingByTarget.get(entry.target);
        if (current) {
          const tags = [...new Set([...inheritedTags, ...current.tags])];
          if (current.kind !== entry.kind || current.name !== entry.name || current.sortOrder !== order ||
              current.fileCreatedAt !== entry.fileCreatedAt || current.fileModifiedAt !== entry.fileModifiedAt ||
              tags.length !== current.tags.length || tags.some((tag, i) => tag !== current.tags[i])) {
            update.run(parentId, entry.kind, entry.name, entry.target, JSON.stringify(tags), order, entry.fileCreatedAt, entry.fileModifiedAt, timestamp, current.id);
            updated += 1;
          }
          seenIds.add(current.id);
        } else {
          const id = randomUUID();
          insert.run(id, parentId, entry.kind, entry.name, entry.target, JSON.stringify(inheritedTags), order, entry.fileCreatedAt, entry.fileModifiedAt, timestamp, timestamp);
          seenIds.add(id);
          added += 1;
        }
        if ((index + 1) % 200 === 0 || index + 1 === includedEntries.length) onProgress?.(index + 1, added, updated);
      });
      const staleRoots = directChildren.filter((item) => {
        if (seenIds.has(item.id)) return false;
        if (item.target) {
          try {
            const metadata = statSync(item.target);
            if (metadata.isFile() || metadata.isDirectory()) return false;
          } catch {
            // Missing targets are removed below together with their descendants.
          }
        }
        return true;
      });
      let removed = 0;
      for (const staleRoot of staleRoots) {
        for (const id of [...this.descendantIds(staleRoot.id)].reverse()) removed += Number(remove.run(id).changes);
        removed += Number(remove.run(staleRoot.id).changes);
      }
      this.db.exec("COMMIT");
      return { added, updated, removed };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listLocalFolderExclusionTargets(parentItemId: string): Set<string> {
    const rows = this.db.prepare(`
      SELECT target_key
      FROM resource_library_exclusions
      WHERE parent_item_id = ?
    `).all(parentItemId) as unknown as Array<{ target_key: string }>;
    return new Set(rows.map((row) => row.target_key));
  }

  isLocalFolderTargetExcluded(parentItemId: string, target: string): boolean {
    return this.listLocalFolderExclusionTargets(parentItemId).has(localTargetKey(target));
  }

  move(id: string, parentId: string | null, beforeId?: string | null): ResourceLibraryItem | undefined {
    const current = this.find(id);
    if (!current) return undefined;
    if (parentId === id) throw new Error("资料不能移动到自身目录");
    this.assertParent(parentId);
    if (parentId && this.descendantIds(id).has(parentId)) {
      throw new Error("资料目录不能移动到自己的子目录");
    }
    const siblings = this.list().filter((item) => item.parentId === parentId && item.id !== id);
    let insertionIndex = siblings.length;
    if (beforeId) {
      insertionIndex = siblings.findIndex((item) => item.id === beforeId);
      if (insertionIndex < 0) throw new Error("排序目标不在目标目录中");
    }
    siblings.splice(insertionIndex, 0, { ...current, parentId });
    const update = this.db.prepare(`
      UPDATE resource_library_items
      SET parent_id = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `);
    const timestamp = this.now().toISOString();
    this.db.exec("BEGIN");
    try {
      siblings.forEach((item, index) => update.run(parentId, index, timestamp, item.id));
      if (current.parentId !== parentId) this.normalizeOrder(current.parentId, timestamp);
      if (parentId && current.target && (current.kind === "local_file" || current.kind === "local_folder")) {
        this.clearLocalFolderExclusion(parentId, current.target);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.find(id);
  }

  update(id: string, patch: ResourceLibraryUpdateInput): ResourceLibraryItem | undefined {
    const current = this.find(id);
    if (!current) return undefined;
    const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
    if (parentId === id) throw new Error("资料不能移动到自身目录");
    this.assertParent(parentId ?? null);
    if (parentId && this.descendantIds(id).has(parentId)) {
      throw new Error("资料目录不能移动到自己的子目录");
    }
    const target = current.kind === "folder"
      ? null
      : patch.target === undefined
        ? current.target
        : patch.target;
    if (current.kind !== "folder" && !target) throw new Error("映射资料必须保留路径或链接");
    const thumbnailDataUrl = patch.thumbnailDataUrl === undefined
      ? patch.target !== undefined && patch.target !== current.target
        ? null
        : current.thumbnailDataUrl ?? null
      : patch.thumbnailDataUrl;
    this.db.prepare(`
      UPDATE resource_library_items
      SET parent_id = ?, name = ?, target = ?, tags_json = ?, folder_color = ?, assistant_permission = ?, file_modified_at = ?, thumbnail_data_url = ?, updated_at = ?
      WHERE id = ?
    `).run(
      parentId,
      patch.name ?? current.name,
      target,
      JSON.stringify(patch.tags ?? current.tags),
      current.kind === "folder" || current.kind === "local_folder" ? patch.folderColor === undefined ? current.folderColor ?? null : patch.folderColor : null,
      current.kind !== "local_folder" ? null : patch.assistantPermission !== undefined ? patch.assistantPermission : target !== current.target ? null : current.assistantPermission ?? null,
      patch.fileModifiedAt === undefined ? current.fileModifiedAt ?? null : patch.fileModifiedAt,
      thumbnailDataUrl,
      this.now().toISOString(),
      id,
    );
    if (parentId && target && (current.kind === "local_file" || current.kind === "local_folder")) {
      this.clearLocalFolderExclusion(parentId, target);
    }
    return this.find(id);
  }

  delete(id: string): boolean {
    const current = this.find(id);
    if (!current) return false;
    const ids = [...this.descendantIds(id), id];
    const remove = this.db.prepare("DELETE FROM resource_library_items WHERE id = ?");
    const removeOwnedExclusions = this.db.prepare("DELETE FROM resource_library_exclusions WHERE parent_item_id = ?");
    this.db.exec("BEGIN");
    try {
      const parent = current.parentId ? this.find(current.parentId) : undefined;
      if (parent?.kind === "local_folder" && current.target &&
          (current.kind === "local_file" || current.kind === "local_folder")) {
        this.db.prepare(`
          INSERT INTO resource_library_exclusions(parent_item_id, target_key, target, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(parent_item_id, target_key) DO UPDATE SET
            target = excluded.target,
            created_at = excluded.created_at
        `).run(parent.id, localTargetKey(current.target), current.target, this.now().toISOString());
      }
      for (const itemId of ids.reverse()) {
        removeOwnedExclusions.run(itemId);
        remove.run(itemId);
      }
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private clearLocalFolderExclusion(parentItemId: string, target: string): void {
    this.db.prepare(`
      DELETE FROM resource_library_exclusions
      WHERE parent_item_id = ? AND target_key = ?
    `).run(parentItemId, localTargetKey(target));
  }

  private assertParent(parentId: string | null): void {
    if (!parentId) return;
    const parent = this.find(parentId);
    if (!parent || !["folder", "local_folder"].includes(parent.kind)) {
      throw new Error("目标虚拟目录不存在");
    }
  }

  private nextSortOrder(parentId: string | null): number {
    const row = parentId
      ? this.db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM resource_library_items WHERE parent_id = ?").get(parentId)
      : this.db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM resource_library_items WHERE parent_id IS NULL").get();
    return Number((row as { max_order: number }).max_order) + 1;
  }

  private normalizeOrder(parentId: string | null, timestamp: string): void {
    const siblings = this.list().filter((item) => item.parentId === parentId);
    const update = this.db.prepare("UPDATE resource_library_items SET sort_order = ?, updated_at = ? WHERE id = ?");
    siblings.forEach((item, index) => update.run(index, timestamp, item.id));
  }

  private descendantIds(id: string): Set<string> {
    const rows = this.db.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM resource_library_items WHERE parent_id = ?
        UNION
        SELECT child.id FROM resource_library_items child JOIN descendants ON child.parent_id = descendants.id
      )
      SELECT id FROM descendants WHERE id <> ?
    `).all(id, id) as { id: string }[];
    return new Set(rows.map(row => row.id));
  }

  private depth(id: string, items: ResourceLibraryItem[]): number {
    const byId = new Map(items.map((item) => [item.id, item]));
    let depth = 0;
    let current = byId.get(id);
    while (current?.parentId && byId.has(current.parentId)) {
      depth += 1;
      current = byId.get(current.parentId);
    }
    return depth;
  }
}
