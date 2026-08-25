import { useRef, useState } from 'preact/hooks';

export default function SubmitForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasValidFile, setHasValidFile] = useState(false);

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    setError(null);

    if (!file) {
      setPreview(null);
      setHasValidFile(false);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      setPreview(null);
      setHasValidFile(false);
      input.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File too large (max 10MB)');
      setPreview(null);
      setHasValidFile(false);
      input.value = '';
      return;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);
    setHasValidFile(true);
  }

  return (
    <form hx-post="/api/cats" hx-encoding="multipart/form-data">
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <input
          ref={fileRef}
          type="file"
          name="image"
          accept="image/*"
          onChange={handleFileChange}
          style="font-size: 0.9rem;"
        />
        {preview && (
          <img
            src={preview}
            alt="Preview"
            style="max-width: 100%; max-height: 200px; border-radius: 4px; object-fit: contain;"
          />
        )}
        {error && <p style="color: red; margin: 0; font-size: 0.85rem;">{error}</p>}
        <input
          type="text"
          name="name"
          placeholder="Cat's name (optional)"
          maxlength={60}
          style="font-size: 0.9rem; padding: 0.35rem;"
        />
        <button
          type="submit"
          style="padding: 0.5rem; font-size: 1rem; cursor: pointer;"
          disabled={!hasValidFile}
        >
          Upload
        </button>
      </div>
    </form>
  );
}
