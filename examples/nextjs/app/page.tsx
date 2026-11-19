import { Uploader } from "./uploader";

// Server Component: renders the client-side uploader.
export default function Page() {
  return (
    <main>
      <h1>UploadRescue · Next.js</h1>
      <p>
        <code>/api/upload</code> rejects files over 1 MB with HTTP 413. Upload a larger image to
        watch it recover.
      </p>
      <Uploader />
    </main>
  );
}
