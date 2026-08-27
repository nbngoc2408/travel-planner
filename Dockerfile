FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY data ./data
COPY scripts ./scripts
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
