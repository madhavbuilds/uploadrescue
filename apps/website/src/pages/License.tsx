import { REPO_URL } from "../site";

export function License() {
  return (
    <div className="container narrow page prose">
      <h1>License</h1>
      <p className="lead">UploadRescue is licensed under the Apache License, Version 2.0.</p>
      <p>
        You may use, modify and distribute UploadRescue — including in commercial and closed-source
        products — provided you keep the license and notices, state significant changes, and do not
        use the project's trademarks to imply endorsement. The license includes an express patent
        grant from contributors.
      </p>
      <p>
        The full text is in the <a href={`${REPO_URL}/blob/main/LICENSE`}>LICENSE</a> file and at{" "}
        <a href="https://www.apache.org/licenses/LICENSE-2.0">apache.org/licenses/LICENSE-2.0</a>.
      </p>
      <h2>Third-party software</h2>
      <ul>
        <li>
          <strong>fflate</strong> (MIT) — DEFLATE compression in the archive and document engines.
        </li>
        <li>
          <strong>pdf-lib</strong> (MIT) — PDF parsing and writing in the PDF engine.
        </li>
        <li>
          <strong>FFmpeg.wasm</strong> (MIT wrapper; FFmpeg core under LGPL/GPL depending on build)
          — optional, installed and hosted by you for the media engine. Review its license for your
          distribution.
        </li>
      </ul>
      <p className="muted">This summary is not legal advice; the license text governs.</p>
    </div>
  );
}
