# test-cats — local fixture photos

Drop cat photos (`.jpg`, `.jpeg`, `.png`, `.webp`, max 10 MB each) into this
folder, then run:

    npm run local:model      # once: fetch the ONNX model
    npm run local:refresh    # rebuild the local dataset from this folder
    npm run dev:local        # browse it at http://localhost:4321

Each refresh **replaces everything**: all cats, likes, and comments in the
local database and all generated images are deleted and rebuilt from the
photos currently in this folder. A cat's name is its filename without the
extension.

Every photo goes through the real production pipeline (size, format, and
extension guards, the ONNX cat check, Sharp WebP processing) — if any photo
fails, the refresh aborts and the previous dataset is left untouched.

In local dev every request uses one fixed user token, so you can like and
comment **once per cat** between refreshes. Everything in this folder except
this file is gitignored.
