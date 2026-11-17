import { describe, expect, it } from "vitest";
import { parseGeo } from "./geo";

const at = (lat: number, lng: number) => ({ ok: true, point: { lat, lng } });

describe("parseGeo", () => {
  it("reads plain coordinates, lat first", () => {
    expect(parseGeo("41.311081, 69.240562")).toEqual(at(41.311081, 69.240562));
    expect(parseGeo("41.311081,69.240562")).toEqual(at(41.311081, 69.240562));
  });

  it("reads Google links: the pin beats the view centre", () => {
    expect(parseGeo("https://www.google.com/maps/place/X/@41.30,69.20,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d41.311081!4d69.240562")).toEqual(at(41.311081, 69.240562));
    expect(parseGeo("https://www.google.com/maps/@41.3,69.24,15z")).toEqual(at(41.3, 69.24));
    expect(parseGeo("https://maps.google.com/?q=41.311081,69.240562")).toEqual(at(41.311081, 69.240562));
  });

  it("reads Yandex and 2GIS links, which put longitude first", () => {
    expect(parseGeo("https://yandex.uz/maps/10335/tashkent/?ll=69.240562%2C41.311081&z=16")).toEqual(at(41.311081, 69.240562));
    expect(parseGeo("https://yandex.uz/maps/?pt=69.240562,41.311081&z=17&l=map")).toEqual(at(41.311081, 69.240562));
    expect(parseGeo("https://2gis.uz/tashkent/geo/69.240562,41.311081")).toEqual(at(41.311081, 69.240562));
  });

  it("refuses short links (the point is behind a redirect) and nonsense", () => {
    expect(parseGeo("https://maps.app.goo.gl/AbCdEf123")).toEqual({ ok: false, reason: "short_link" });
    expect(parseGeo("https://yandex.uz/maps/-/CDqZ5Ek~")).toEqual({ ok: false, reason: "short_link" });
    expect(parseGeo("Chilonzor 12")).toEqual({ ok: false, reason: "unknown" });
    expect(parseGeo("191.2, 69.1")).toEqual({ ok: false, reason: "unknown" });
    expect(parseGeo("0, 0")).toEqual({ ok: false, reason: "unknown" });
  });
});
