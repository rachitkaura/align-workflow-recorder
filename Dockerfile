FROM mcr.microsoft.com/playwright:v1.64.1-noble
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY *.mjs ./
RUN chown -R pwuser:pwuser /app
USER pwuser
# A deployment build must prove it can record actual browser actions.
RUN npm test && npm run test:browser
ENV NODE_ENV=production PORT=3000 OUTPUT_DIR=/app/recordings
EXPOSE 3000
CMD ["node", "server.mjs"]
