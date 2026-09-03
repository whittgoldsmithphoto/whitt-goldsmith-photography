FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Live production: GitHub → Vercel (HOSTING.md). This image is a private VPS trial.
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "dev"]
