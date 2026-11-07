// Copyright © 2026 Alen Pepa
import { modelCatalogData } from "./model-catalog-data.ts";
export { catalogVersion } from "./model-catalog-data.ts";

export type CatalogModel = { id: string; name: string; family: string; precision: string; memoryGB: number; requiredFeatures: string[]; bufferBytes: number | null; contextWindow: number; sourceUrl: string; downloadGB: number | null };
export const modelCatalog: readonly CatalogModel[] = modelCatalogData;
const byId = new Map(modelCatalog.map(model => [model.id, model]));
export function getConversationModel(id: unknown): CatalogModel | undefined { return typeof id === "string" ? byId.get(id) : undefined; }
