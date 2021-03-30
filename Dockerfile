FROM node:12-buster-slim

LABEL maintainer=Gaurav

RUN apt-get update && \
  mkdir -p /usr/share/man/man1 && \
  apt-get -y install pdftk-java ghostscript wget

COPY ./package.json /app/package.json

WORKDIR /app

RUN npm install && \
  npm cache clean --force

EXPOSE 12345
EXPOSE 9229

COPY . /app

CMD ["npm", "start"]