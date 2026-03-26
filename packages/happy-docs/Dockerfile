# Multi-stage build: export static site then serve with Node
FROM node:20-slim AS builder

WORKDIR /app
COPY . .
RUN npm install -g mint@4.2.454 && mint export

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/export.zip .
RUN apt-get update && apt-get install -y unzip && rm -rf /var/lib/apt/lists/* \
    && unzip export.zip -d site && rm export.zip

# Fix: mint export uses page/index.html structure, but serve.js only checks
# dir/index.html. Add dir/index/index.html as a candidate for directory URLs
# like /zh to resolve correctly.
RUN node -e "\
  const f = 'site/serve.js'; \
  let s = require('fs').readFileSync(f,'utf8'); \
  s = s.replace( \
    'path.join(filePath, \'index.html\'), filePath + \'.html\'', \
    'path.join(filePath, \"index.html\"), path.join(filePath, \"index\", \"index.html\"), filePath + \".html\"' \
  ); \
  require('fs').writeFileSync(f, s);"

EXPOSE 3000
CMD ["node", "site/serve.js"]
