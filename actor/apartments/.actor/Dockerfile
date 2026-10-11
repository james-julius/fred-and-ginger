FROM apify/actor-node-playwright-chrome:22-1.62.1
COPY --chown=myuser package*.json ./
RUN npm --quiet set progress=false && npm install --omit=dev && npm cache clean --force
COPY --chown=myuser . ./
CMD npm start --silent
