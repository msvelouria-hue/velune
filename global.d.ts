export {};

declare global {
  var onItemsUpdated: (() => void) | undefined;
  var onPhotoTaken: ((photoUri: string) => void) | undefined;
}
