FROM golang:1.26-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -trimpath -ldflags='-s -w' -o /out/model-router ./cmd/lite-cpa

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -H -u 10001 siriusx
WORKDIR /app
COPY --from=build /out/model-router /usr/local/bin/model-router
RUN mkdir -p /app/config /app/data && chown -R siriusx:siriusx /app
USER siriusx
EXPOSE 8317
VOLUME ["/app/config", "/app/data"]
ENTRYPOINT ["model-router"]
CMD ["--config", "/app/config/config.yaml"]
