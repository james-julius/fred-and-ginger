FROM apify/actor-node:22
COPY --chown=myuser package*.json ./
RUN npm --quiet set progress=false && npm install --omit=dev --no-optional && npm cache clean --force
COPY --chown=myuser . ./
CMD npm start --silent
