# GranaFarm — imagine de producție
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# Instalăm doar dependențele de producție (cache eficient)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
# Verificăm că dependențele critice s-au instalat (build-ul eșuează altfel)
RUN node -e "require.resolve('express'); require.resolve('pg')"

# Codul aplicației
COPY server.js ./
COPY lib ./lib
COPY public ./public

EXPOSE 3000

# Verificare stare pentru orchestrator
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
