use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;
use tracing::warn;

const API: &str = "https://api.unsplash.com";
const PER_PAGE: u32 = 24;
const DOWNLOAD_WIDTH: u32 = 2560;
const TIMEOUT: Duration = Duration::from_secs(30);
const APP_NAME: &str = "capt";

#[derive(Serialize, Deserialize, Type, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnsplashPhoto {
    pub id: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub width: u32,
    pub height: u32,
    pub thumb_url: String,
    pub preview_url: String,
    pub raw_url: String,
    pub page_url: String,
    pub download_location: String,
    pub photographer: String,
    pub photographer_url: String,
}

#[derive(Serialize, Type, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnsplashPage {
    pub photos: Vec<UnsplashPhoto>,
    pub total_pages: u32,
}

#[derive(Serialize, Deserialize, Type, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnsplashAttribution {
    pub photo_id: String,
    pub photographer: String,
    pub photographer_url: String,
    pub page_url: String,
}

#[derive(Serialize, Type, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnsplashPick {
    pub path: String,
    pub attribution: UnsplashAttribution,
}

#[derive(Deserialize)]
struct ApiUrls {
    raw: String,
    small: String,
    regular: String,
}

#[derive(Deserialize)]
struct ApiLinks {
    html: String,
    download_location: String,
}

#[derive(Deserialize)]
struct ApiUserLinks {
    html: String,
}

#[derive(Deserialize)]
struct ApiUser {
    name: String,
    links: ApiUserLinks,
}

#[derive(Deserialize)]
struct ApiPhoto {
    id: String,
    description: Option<String>,
    alt_description: Option<String>,
    color: Option<String>,
    width: u32,
    height: u32,
    #[serde(default)]
    premium: bool,
    #[serde(default)]
    plus: bool,
    urls: ApiUrls,
    links: ApiLinks,
    user: ApiUser,
}

#[derive(Deserialize)]
struct ApiSearch {
    results: Vec<ApiPhoto>,
    total_pages: u32,
}

fn access_key(app: &AppHandle) -> Option<String> {
    let from_settings = app
        .store("store")
        .ok()
        .and_then(|store| store.get("unsplash"))
        .and_then(|value| value.get("accessKey")?.as_str().map(str::to_string));
    from_settings
        .or_else(|| std::env::var("UNSPLASH_ACCESS_KEY").ok())
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(format!("{APP_NAME}/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not start the Unsplash request: {error}"))
}

fn utm(url: &str) -> String {
    let joiner = if url.contains('?') { '&' } else { '?' };
    format!("{url}{joiner}utm_source={APP_NAME}&utm_medium=referral")
}

fn convert(photo: ApiPhoto) -> UnsplashPhoto {
    UnsplashPhoto {
        id: photo.id,
        description: photo.description.or(photo.alt_description),
        color: photo.color,
        width: photo.width,
        height: photo.height,
        thumb_url: photo.urls.small,
        preview_url: photo.urls.regular,
        raw_url: photo.urls.raw,
        page_url: utm(&photo.links.html),
        download_location: photo.links.download_location,
        photographer: photo.user.name,
        photographer_url: utm(&photo.user.links.html),
    }
}

fn backgrounds_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("backgrounds");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn sidecar_path(image_path: &str) -> PathBuf {
    PathBuf::from(format!("{image_path}.unsplash.json"))
}

async fn fail_for_status(response: reqwest::Response) -> Result<reqwest::Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let message = match status.as_u16() {
        401 => "Unsplash rejected the access key".to_string(),
        403 => "Unsplash rate limit reached; try again in an hour".to_string(),
        _ => format!("Unsplash error {status}"),
    };
    Err(message)
}

async fn search(key: &str, query: &str, page: u32) -> Result<UnsplashPage, String> {
    let client = client()?;
    let page = page.max(1).to_string();
    let per_page = PER_PAGE.to_string();
    let query = query.trim();

    let response = if query.is_empty() {
        client.get(format!("{API}/photos")).query(&[
            ("order_by", "popular"),
            ("page", &page),
            ("per_page", &per_page),
        ])
    } else {
        client.get(format!("{API}/search/photos")).query(&[
            ("query", query),
            ("page", &page),
            ("per_page", &per_page),
            ("content_filter", "high"),
        ])
    }
    .header("Authorization", format!("Client-ID {key}"))
    .header("Accept-Version", "v1")
    .send()
    .await
    .map_err(|error| format!("Could not reach Unsplash: {error}"))?;
    let response = fail_for_status(response).await?;

    let (photos, total_pages) = if query.is_empty() {
        let photos: Vec<ApiPhoto> = response
            .json()
            .await
            .map_err(|error| format!("Unsplash sent an unreadable reply: {error}"))?;
        (photos, 50)
    } else {
        let search: ApiSearch = response
            .json()
            .await
            .map_err(|error| format!("Unsplash sent an unreadable reply: {error}"))?;
        (search.results, search.total_pages)
    };

    Ok(UnsplashPage {
        photos: photos
            .into_iter()
            .filter(|photo| !photo.premium && !photo.plus)
            .map(convert)
            .collect(),
        total_pages,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn unsplash_search(
    app: AppHandle,
    query: String,
    page: u32,
) -> Result<UnsplashPage, String> {
    let key = access_key(&app).ok_or("Add an Unsplash access key in Settings first")?;
    search(&key, &query, page).await
}

async fn pick(key: &str, dir: &Path, photo: UnsplashPhoto) -> Result<UnsplashPick, String> {
    let client = client()?;
    let auth = format!("Client-ID {key}");

    // The API guidelines require hitting download_location whenever a photo is
    // used, so the photographer gets credited for the download.
    if let Err(error) = client
        .get(&photo.download_location)
        .header("Authorization", &auth)
        .header("Accept-Version", "v1")
        .send()
        .await
    {
        warn!(%error, "Unsplash download tracking failed");
    }

    let image_url = format!(
        "{}&w={DOWNLOAD_WIDTH}&q=85&fm=jpg&fit=max",
        photo.raw_url.trim_end_matches('&')
    );
    let bytes = client
        .get(&image_url)
        .send()
        .await
        .map_err(|error| format!("Could not download the photo: {error}"))?;
    let bytes = fail_for_status(bytes)
        .await?
        .bytes()
        .await
        .map_err(|error| format!("Could not download the photo: {error}"))?;

    let path = dir.join(format!("unsplash-{}.jpg", photo.id));
    std::fs::write(&path, &bytes).map_err(|error| format!("Could not save the photo: {error}"))?;
    let path = path.to_string_lossy().to_string();

    let attribution = UnsplashAttribution {
        photo_id: photo.id,
        photographer: photo.photographer,
        photographer_url: photo.photographer_url,
        page_url: photo.page_url,
    };
    if let Ok(json) = serde_json::to_vec(&attribution) {
        if let Err(error) = std::fs::write(sidecar_path(&path), json) {
            warn!(%error, "Could not write Unsplash attribution");
        }
    }

    Ok(UnsplashPick { path, attribution })
}

#[tauri::command]
#[specta::specta]
pub async fn unsplash_pick(app: AppHandle, photo: UnsplashPhoto) -> Result<UnsplashPick, String> {
    let key = access_key(&app).ok_or("Add an Unsplash access key in Settings first")?;
    let dir = backgrounds_dir(&app)?;
    pick(&key, &dir, photo).await
}

#[tauri::command]
#[specta::specta]
pub fn unsplash_attribution(path: String) -> Option<UnsplashAttribution> {
    let bytes = std::fs::read(sidecar_path(&path)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "calls the Unsplash API; set UNSPLASH_ACCESS_KEY"]
    async fn searches_and_downloads_a_free_photo() {
        let key = std::env::var("UNSPLASH_ACCESS_KEY").unwrap();
        let page = search(&key, "mountains", 1).await.unwrap();
        assert!(!page.photos.is_empty());
        let popular = search(&key, "", 1).await.unwrap();
        assert!(!popular.photos.is_empty());

        let dir = std::env::temp_dir().join(format!("capt-unsplash-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let photo = page.photos[0].clone();
        let picked = pick(&key, &dir, photo.clone()).await.unwrap();
        let bytes = std::fs::read(&picked.path).unwrap();
        assert!(bytes.len() > 50_000, "downloaded {} bytes", bytes.len());
        assert_eq!(&bytes[..2], &[0xff, 0xd8]);
        assert_eq!(
            unsplash_attribution(picked.path.clone()).unwrap().photo_id,
            photo.id
        );
        println!(
            "{} by {} -> {} ({} KB)",
            photo.id,
            picked.attribution.photographer,
            picked.path,
            bytes.len() / 1024
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
