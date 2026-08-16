# basenote-media
Static image/video CDN for Base Note blog content. Put files under `public/img/<article-handle>/...` and run `npx wrangler deploy` from this directory.
Assets are content-addressed on Cloudflare's edge; keep filenames stable and never overwrite an existing published path (add a `-v2` suffix instead) so cached article HTML never breaks.
