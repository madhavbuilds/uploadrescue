// Minimal typings for third-party SDKs referenced in the docs (not installed in this repo).
declare module "@supabase/supabase-js" {
  import type { SupabaseStorageLike } from "@uploadrescue/upload-adapters";
  export function createClient(url: string, key: string): { storage: SupabaseStorageLike };
}
declare module "firebase/storage" {
  import type { FirebaseUploadTaskLike } from "@uploadrescue/upload-adapters";
  export interface StorageReference {
    fullPath: string;
  }
  export function getStorage(): unknown;
  export function ref(storage: unknown, path: string): StorageReference;
  export function uploadBytesResumable(ref: StorageReference, data: Blob, metadata?: { contentType?: string }): FirebaseUploadTaskLike;
}
