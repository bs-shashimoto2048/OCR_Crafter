export const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

async function parseErrorDetail(response) {
  const fallback = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const payload = JSON.parse(text);
      // 統一エラー形式 {error_code, message, details, related_id}（旧形式 detail 文字列も互換）
      if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
      const detail = payload?.detail;
      if (typeof detail === "string" && detail.trim()) return detail;
      if (detail && typeof detail === "object" && typeof detail.message === "string") return detail.message;
      if (Array.isArray(detail)) return detail.map((v) => String(v?.msg ?? v)).join(", ");
    } catch {
      // not json
    }
    return text;
  } catch {
    return fallback;
  }
}

export async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error(await parseErrorDetail(response));
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function imageUrl(imageName, projectId = "default", version = 0) {
  const name = encodeURIComponent(String(imageName || ""));
  const pid = encodeURIComponent(String(projectId || "default"));
  return `${API_BASE}/images/${name}/file?project_id=${pid}&v=${encodeURIComponent(String(version ?? 0))}`;
}

export function thumbnailUrl(imageName, projectId = "default", version = 0, width = 240, height = 96) {
  const name = encodeURIComponent(String(imageName || ""));
  const pid = encodeURIComponent(String(projectId || "default"));
  return `${API_BASE}/images/${name}/thumbnail?project_id=${pid}&width=${width}&height=${height}&v=${encodeURIComponent(String(version ?? 0))}`;
}

export function interimImageUrl(imageName, projectId = "default", version = 0) {
  const name = encodeURIComponent(String(imageName || ""));
  const pid = encodeURIComponent(String(projectId || "default"));
  return `${API_BASE}/images/${name}/interim?project_id=${pid}&v=${encodeURIComponent(String(version ?? 0))}`;
}

export function processedImageUrl(imageName, projectId = "default", version = 0, imageType = "") {
  const name = encodeURIComponent(String(imageName || ""));
  const pid = encodeURIComponent(String(projectId || "default"));
  const type = encodeURIComponent(String(imageType || ""));
  return `${API_BASE}/images/${name}/processed?project_id=${pid}&image_type=${type}&v=${encodeURIComponent(String(version ?? 0))}`;
}
