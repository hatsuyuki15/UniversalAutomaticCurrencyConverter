/**
 * Taken from https://github.com/GoogleChrome/chrome-app-samples/tree/master/samples/managed-in-app-payments
 * Variable naming has been expanded to best usage approximation
 */
(function () {
    var self = this,
        listener = function (event, action) {
            var eventParts = event.split("."),
                actor = window || self;
            eventParts[0] in actor || !actor.execScript || actor.execScript("var " + eventParts[0]);
            for (var e; eventParts.length && (e = eventParts.shift());)
                eventParts.length || void 0 === action
                    ? actor = actor[e]
                    ? actor[e]
                    : actor[e] = {}
                    : actor[e] = action
        };
    var callGoogle = function (respondSender) {
        // TODO: figure out wtf this string is
        var connection = chrome.runtime.connect("nmmhkkegccagdldgiimedpiccmgmieda", {}),
            // UwU, who wrote this horror
            OwO = !1;
        connection.onMessage.addListener(function (input) {
            OwO = !0;
            "response" in input && !("errorType" in input.response) ? respondSender.success && respondSender.success(input) : respondSender.failure && respondSender.failure(input)
        });
        connection.onDisconnect.addListener(function () {
            !OwO && respondSender.failure && respondSender.failure({
                request: {},
                response: {errorType: "INTERNAL_SERVER_ERROR"}
            })
        });
        connection.postMessage(respondSender)
    };
    listener("google.payments.inapp.buy", function (parameters) {
        parameters.method = "buy";
        callGoogle(parameters)
    });
    listener("google.payments.inapp.consumePurchase", function (parameters) {
        parameters.method = "consumePurchase";
        callGoogle(parameters)
    });
    listener("google.payments.inapp.getPurchases", function (parameters) {
        parameters.method = "getPurchases";
        callGoogle(parameters)
    });
    listener("google.payments.inapp.getSkuDetails", function (parameters) {
        parameters.method = "getSkuDetails";
        callGoogle(parameters)
    });
})();

let _buyWrapperInstance;

class BuyWrapper {
    /**
     * @returns {BuyWrapper}
     */
    static get instance() {
        return _buyWrapperInstance
            ? _buyWrapperInstance
            : (_buyWrapperInstance = new BuyWrapper());
    }

    constructor(env = undefined) {
        this._env = env || 'test';
    }

    /**
     * @returns {Promise<{
     *     success: boolean,
     *     data: Purchase[]|undefined,
     *     error: ChromeBuyError|undefined
     * }>}
     */
    oldPurchases() {
        return new Promise((resolve => {
            google.payments.inapp.getPurchases({
                'parameters': {'env': this._env},
                'success': resp => resolve({
                    success: true,
                    data: resp.response.details.map(e => new Purchase(e))
                }),
                'failure': error => resolve({
                    success: false,
                    error: new ChromeBuyError(error.response)
                })
            });
        }));
    }

    /**
     * @returns {Promise<{
     *     success: boolean,
     *     data: Product[]|undefined,
     *     error: ChromeBuyError|undefined
     * }>}
     */
    items() {
        return new Promise((resolve => {
            google.payments.inapp.getSkuDetails({
                'parameters': {'env': this._env},
                'success': resp => resolve({
                    success: true,
                    data: resp.response.details.inAppProducts.map(e => new Product(e))
                }),
                'failure': error => resolve({
                    success: false,
                    error: new ChromeBuyError(error.response)
                })
            });
        }));
    }

    /**
     * @param product
     * @returns {Promise<{
     *     success: boolean,
     *     data: BuyResponse|undefined,
     *     error: ChromeBuyError|undefined
     * }>}
     */
    purchase(product) {
        return new Promise((resolve => {
            google.payments.inapp.buy({
                'parameters': {'env': this._env},
                'sku': product.sku,
                'success': resp => resolve({
                    success: true,
                    data: new BuyResponse(resp)
                }),
                'failure': error => resolve({
                    success: false,
                    error: new ChromeBuyError(error.response)
                })
            });
        }));
    }
}

class ChromeBuyError {
    /**
     * @param {*} error
     */
    constructor(error) {
        this.rawError = error;
        this.type = error.errorType;
    }
}

class Purchase {
    /**
     * @param {{
            kind: string,
            itemId: string,
            sku: string,
            createdTime: string,
            state: string
        }} data
     */
    constructor(data) {
        this.kind = data.kind;
        this.id = data.itemId;
        this.sku = data.sku;
        this.createdTime = new Date(data.createdTime - 0);
        this.state = data.state;
    }
}

class BuyResponse {
    constructor(data) {
        this.jwt = data.jwt;
        this.cardId = data.request.cardId;
        this.orderId = data.response.orderId;
    }
}

class Product {
    /**
     * @param {{
            kind: string,
            sku: string,
            item_id: string,
            type: string,
            state: string,
            prices:  {
                valueMicros: string,
                currencyCode: string,
                regionCode: string
            }[],
            localeData:  {
                title: string,
                description: string,
                languageCode: string
            }[]
     * }}rawProduct
     */
    constructor(rawProduct) {
        this.kind = rawProduct.kind;
        this.sku = rawProduct.sku;
        this.id = rawProduct.item_id;
        this.type = rawProduct.type;
        this.state = rawProduct.state;
        this.prices = rawProduct.prices
            .map(e => new ProductPrice(e));
        this.localeData = rawProduct.localeData
            .map(e => new ProductLocaleData(e));
    }
}

class ProductPrice {
    /**
     * @param {{
                valueMicros: string,
                currencyCode: string,
                regionCode: string
            }} price
     */
    constructor(price) {
        this.valueMicros = price.valueMicros;
        this.currencyCode = price.valueMicros;
        this.regionCode = price.regionCode;
    }

    /**
     * @returns {number}
     */
    get price() {
        return this.valueMicros / 1000;
    }
}

class ProductLocaleData {
    /**
     * @param {{
                title: string,
                description: string,
                languageCode: string
            }} data
     */
    constructor(data) {
        this.title = data.title;
        this.description = data.description;
        this.languageCode = data.languageCode;
    }
}