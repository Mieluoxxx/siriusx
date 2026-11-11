FROM teams-bridge:0.2.0
WORKDIR /app
COPY dist /app/dist
COPY server.mjs /app/server.mjs
ENV PORT=8090
ENV HOST=0.0.0.0
EXPOSE 8090
CMD ["node", "server.mjs"]
