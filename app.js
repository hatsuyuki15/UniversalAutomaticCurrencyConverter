const express = require('express');
const fetch = require('node-fetch');
const UUID = ({generate: () => require('uuid/v4')()});
const path = require('path');
const AppInsight = require("applicationinsights");
const Stripe = require('stripe');

let _TrackerInstance;
let _ConfigInstance;
let _StripeInstance;

class StripeWrapper {

    static instance(publicKey, secretKey) {
        return _StripeInstance ? _StripeInstance : (_StripeInstance = new StripeWrapper(publicKey, secretKey));
    }

    static async charge(amount, currency, email) {
        return await StripeWrapper.instance().charge(amount, currency, email);
    }

    constructor(publicKey, secretKey) {
        this._publicKey = publicKey;
        this._secretKey = secretKey;
        this.client = Stripe(this._secretKey);
    }

    async charge(amount, currency, email) {
        return await this.client.charges.create({
            amount: amount,
            currency: currency,
            source: 'tok_visa',
            receipt_email: email,
        }).catch(e => ({
            error: {
                message: e.message,
                code: e.code,
                param: e.param
            }
        }));
    }
}

class Tracker {
    static instance(key) {
        return _TrackerInstance ? _TrackerInstance : (_TrackerInstance = new Tracker(key));
    }

    static in(req, res) {
        return Tracker.instance().in(req, res);
    }

    static out(req) {
        return Tracker.instance().out(req);
    }

    constructor(key) {
        if (!key) return;
        AppInsight.setup(key)
            .setAutoDependencyCorrelation(true)
            .setAutoCollectRequests(true)
            .setAutoCollectPerformance(true)
            .setAutoCollectExceptions(true)
            .setAutoCollectDependencies(true)
            .setAutoCollectConsole(true)
            .setUseDiskRetryCaching(true)
            .start();
        this.client = AppInsight.defaultClient;
    }

    get isDisabled() {
        return !this.client;
    }

    get isEnabled() {
        return !this.isDisabled;
    }

    in(request, response) {
        if (this.isDisabled) return;
        this.client.trackNodeHttpRequest({request: request, response: response});
    }

    /**
     * @param url
     * @param opt
     * @param {string} returns
     * @return {Promise<object>}
     */
    out(url, opt = {method: 'GET'}, returns = 'json') {
        const self = this;
        const pull = resp => returns === 'text'
            ? resp.text()
            : resp.json();

        return new Promise((resolve, reject) => {
            const start = Date.now();
            const request = fetch(url, opt);
            request.then(resp => {
                const result = resp.ok ? pull(resp) : resp.statusText;
                if (self.isEnabled)
                    self.client.trackRequest({
                        name: opt.method,
                        url: resp.url,
                        duration: Date.now() - start,
                        resultCode: resp.status,
                        success: resp.ok,
                        source: result,
                    });
                if (resp.ok) resolve(result); else reject(result);
            }).catch(e => reject(e));
        });
    }
}

class Config {
    static instance(env) {
        return _ConfigInstance ? _ConfigInstance : (_ConfigInstance = new Config(env));
    }

    static get apikey() {
        return Config.instance()._apikey;
    }

    static get port() {
        return Config.instance()._port;
    }

    static get donation() {
        return Config.instance()._donation;
    }

    constructor(env) {
        this._port = env.PORT || 3000;
        this._apikey = env.apikey;
        Tracker.instance(env.insightkey);
        StripeWrapper.instance(env.donationPublicKey, env.donationPrivateKey);
    }
}

class DonateTicket {

    get created() {
        return this._created;
    }

    get isValid() {
        return Date.now() < this.created + 1000 * 60 * 30;
    }

    get id() {
        return this._id;
    }

    constructor() {
        this._created = Date.now();
        this._id = UUID.generate();
    }

}

Config.instance(process.env);

const data = {
    symbols: null,
    rates: null,
    ids: {}
};

const urls = {
    symbols: `http://data.fixer.io/api/symbols?access_key=${encodeURIComponent(Config.apikey)}`,
    rates: `http://data.fixer.io/api/latest?access_key=${encodeURIComponent(Config.apikey)}`
};

const update = async () => {
    const rates = await Tracker.out(urls.rates).catch(console.error);
    const symbols = await Tracker.out(urls.symbols).catch(console.error);
    data.rates = rates && rates.success ? rates : data.rates;
    data.symbols = symbols && symbols.success ? symbols : data.symbols;
    Object.keys(data.ids).forEach(id => {
        const ticket = data.ids[id];
        if (!ticket.isValid) delete data.ids[id];
    });
};

const api = express();
api.use(express.json());
api.use(express.urlencoded({extended: true}));
api.use(express.static(`${__dirname}/donation`));

console.log('Initiating');
update().finally(() => {
    console.log('Starting');

    // Update occasionally
    setInterval(() => update(), 1000 * 60 * 60 * 12);

    const handleRobots = resp => resp.type('text/plain').status(200).send('User-agent: *\nDisallow: /');

    // Handle robots
    api.get('/robots.txt', (request, response) => handleRobots(response));
    api.get('/robots933456.txt', (request, response) => handleRobots(response));

    // Currency rates endpoint
    api.get('/api/rates', (request, response) => {
        Tracker.in(request, response);
        return data.rates
            ? response.status(200).send(data.rates)
            : response.status(500).send('Dont have any rates');
    });
    // Currency symbols endpoint
    api.get('/api/symbols', (request, response) => {
        Tracker.in(request, response);
        return data.symbols
            ? response.status(200).send(data.symbols)
            : response.status(500).send('Dont have any symbols');
    });

    api.get('/', (request, response) => {
        const base = request.params.base;
        Tracker.in(request, response);
        const file = path.join(__dirname, `donation/donation.html`);
        response
            .contentType(file)
            .sendFile(file);
    });

    api.get('/api/donation', (request, response) => {
        Tracker.in(request, response);
        const ticket = new DonateTicket();
        data.ids[ticket.id] = ticket;
        response.status(200).send({id: ticket.id});
    });

    api.post('/api/donation', async (request, response) => {
        const body = request.body;

        if (!body) return response.status(400).send('Missing all request data');

        const ticket = body.id ? data.ids[body.id] : null;
        if (ticket) delete data.ids[ticket.id];
        // stripe works in cents, so add 2 extra zeroes
        const amount = (Math.floor(body.amount) + '00') - 0;
        const currency = body.currency;
        const email = body.email;

        const stripe = StripeWrapper.instance().client;
        const elements = stripe.elements();
        const card = elements.create('card');
        const promise = stripe.createToken(card);
        const a = await promise;

        if (!ticket)
            return response.status(400).send({
                success: false,
                message: 'Ticket is invalid, click donate to get a valid ticket'
            });

        if (!ticket.isValid) {
            return response.status(400).send({
                success: false,
                message: 'Ticket is expired, click donate to refresh ticket'
            });
        }

        if (!amount || isNaN(amount) || !isFinite(amount) || amount <= 0)
            return response.status(400).send({
                success: false,
                message: 'Amount must be a positive number'
            });

        if (!currency || !currency.match(/^[A-Z]{3}$/))
            return response.status(400).send({
                success: false,
                message: 'Missing request currency'
            });

        if (!email || !body.email.match(/^[^@]+@[^.]+\..+$/))
            return response.status(400).send({
                success: false,
                message: 'Invalid email format, needs to be fx name@gmail.com'
            });

        const resp = await StripeWrapper.charge(amount, currency, email);
        if (!resp.error)
            return response.status(200).send({success: true});

        return response.status(400).send({
            success: false,
            message: resp.error.message
        });
    });

    api.listen(Config.port, () => {
        console.log('Started');
        console.log(`Port: ${Config.port}`);
    });
})
;