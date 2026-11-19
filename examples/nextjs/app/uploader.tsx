"use client";

import { UploadRescue } from "@uploadrescue/react";
import { createXhrUpload } from "@uploadrescue/upload-adapters";

const upload = createXhrUpload({ url: "/api/upload" });

export function Uploader() {
  return (
    <UploadRescue onUpload={upload} acceptedTypes={["image/*"]} recovery={{ autoRetry: true }} />
  );
}
