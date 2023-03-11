// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.167.0/http/server.ts";
import { Hono } from "https://deno.land/x/hono@v3.0.2/mod.ts";
import { compress, cors, serveStatic } from "https://deno.land/x/hono@v3.0.2/middleware.ts";

import redaxios from "https://deno.land/x/redaxios@0.5.1/mod.ts";
import { parse } from "https://deno.land/x/xml@2.1.0/mod.ts";

/*
||  ==================================================
||  Types
||  ==================================================
*/

type ExchangeRate = {
  amount: number;
  base: string;
  date: number;
  rates: Record<string, number>;
};

/*
||  ==================================================
||  Utilities
||  ==================================================
*/

const isTypeofString = (value: unknown): value is string => typeof value === "string";
const isTypeofNumber = (value: unknown): value is number => typeof value === "number";
const isTypeofObject = (value: unknown): value is Record<string, unknown> => typeof value === "object";
const isNotNull = (value: unknown): value is any => value != null;
const isObject = (value: unknown): value is Record<PropertyKey, any> => isTypeofObject(value) && isNotNull(value);
const isArray = (value: unknown): value is any[] => Array.isArray(value);

class MapX<K, V> extends Map<K, V> {
  private maxSize: number;

  constructor(maxSize: number) {
    super();
    this.maxSize = maxSize;
  }

  private get head(): K {
    return this.keys().next().value;
  }
  public peek(key: K): V | undefined {
    return super.get(key);
  }
  public get(key: K): V | undefined {
    const item = this.peek(key);
    if (item !== undefined) {
      super.delete(key);
      super.set(key, item);
    }
    return item;
  }
  public set(key: K, value: V): this {
    super.delete(key);
    if (this.size === this.maxSize) super.delete(this.head);

    super.set(key, value);
    return this;
  }
}

const convertRawJsonDataToFormatedJsonData = (value: any) => {
  if (isObject(value)) {
    const result: Record<PropertyKey, any> = { amount: 1.0, base: "EUR" };

    if ("gesmes:Envelope" in value) {
      const object_gesmesEnvelope = value["gesmes:Envelope"];

      if (isObject(object_gesmesEnvelope) && "Cube" in object_gesmesEnvelope) {
        const object_firstCube = object_gesmesEnvelope["Cube"];

        if (isObject(object_firstCube) && "Cube" in object_firstCube) {
          const object_secondCube = object_firstCube["Cube"];

          if (isObject(object_secondCube)) {
            if ("@time" in object_secondCube) {
              const string_time = object_secondCube["@time"];
              if (isTypeofString(string_time)) result["date"] = string_time;
            }

            if ("Cube" in object_secondCube) {
              const array_thirdCube = object_secondCube["Cube"];

              if (isArray(array_thirdCube)) {
                const arrayObject: Record<PropertyKey, any> = {};

                array_thirdCube.forEach((item) => {
                  if (isObject(item)) {
                    if ("@currency" in item && "@rate" in item) {
                      const item_currency = item["@currency"];
                      const item_rate = item["@rate"];

                      if (isTypeofString(item_currency) && item_currency != "" && isTypeofNumber(item_rate)) arrayObject[item_currency] = item_rate;
                    }
                  }
                });

                result["rates"] = arrayObject;
              }
            }
          }
        }
      }
    }

    if ("date" in result && "rates" in result) return result as ExchangeRate;
  }

  return undefined;
};

/*
||  ==================================================
||  Variables
||  ==================================================
*/

const ExchangeRateMap = new MapX<string, ExchangeRate>(99);

/*
||  ==================================================
||  App
||  ==================================================
*/

const getResourceUpdatedTimeKey = () => {
  const local = new Date(),
    target /* CET */ = new Date(
      Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds(), local.getMilliseconds()) -
        61200000 /* (60m * 60s * 1000ms) * (1 + 16)hour */
    );

  return `${target.getDate()}-${target.getMonth()}-${target.getFullYear()}`;
};

const app = new Hono();

app.use("*", compress());
app.use("*", cors());
app.use("/favicon.ico", serveStatic({ path: "./favicon.ico" }));
app.get("/latest", async (c) => {
  const key = getResourceUpdatedTimeKey();
  let cached: ExchangeRate | undefined = ExchangeRateMap.get(key);
  if (typeof cached !== "undefined") return c.json(cached);
  cached = convertRawJsonDataToFormatedJsonData(parse(String((await redaxios("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")).data)));
  if (typeof cached !== "undefined") ExchangeRateMap.set(key, cached);
  return c.json(cached);
});
app.get("/", (c) => c.json({ name: "exchangerates-apideno" }));
app.get("*", (c) => c.json({ 404: "not-found" }));

serve(app.fetch);
