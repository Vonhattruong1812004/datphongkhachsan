# Room image library

The `uploads/phong/sample-*.jpg` files are licensed illustrative images, not
verified photographs of the listed properties. Customer-facing room views mark
them as "Ảnh minh họa" and link to their source. They must be replaced with
verified property photographs before using them as real inventory photography.

Source URLs, license URLs and compatible room categories are recorded in
`src/shared/media/room-image-catalog.ts`:

- Pexels: <https://www.pexels.com/license/>
- Unsplash: <https://unsplash.com/license>

Downloads are stored locally at 1280px width. The importer checks HTTP status,
image content type, JPEG signature, size and duplicate SHA-256 hashes. It never
overwrites existing files. Browser decoding is also checked when curating assets.

Download missing assets and preview database changes:

```sh
npx tsx src/scripts/import-room-images.ts --diversify-samples
```

Apply missing-image repairs and diversify repeated numbered seed photos:

```sh
npx tsx src/scripts/import-room-images.ts --apply --diversify-samples
```

Without `--diversify-samples`, only missing local images are repaired. Existing
custom uploads and remote URLs are preserved. Each run saves original image paths,
planned replacements and source checksums in `storage/room-images/`. Database
updates are atomic and abort if a room's image changed concurrently. Re-running
after a successful import does not reassign sample images.

Home, booking and manager listings share `src/shared/media/room-images.ts` so
the same room keeps the same image across pages. Missing files use a stable,
locally available illustrative fallback; they do not select random remote images.
