const Ajax = {
    get: url => new Promise((resolve, reject) => {
        if (!url) return reject('No url given');
        const request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.onreadystatechange = function () {
            if (request.readyState !== XMLHttpRequest.DONE)
                return;
            return request.status >= 200 && request.status < 300
                ? resolve(JSON.parse(request.responseText))
                : reject(request.responseText);
        };
        request.send();
    }),
    post: (url, data) => new Promise((resolve, reject) => {
        if (!url) return reject('No url given');
        const request = new XMLHttpRequest();
        request.open('POST', url, true);
        request.setRequestHeader("Content-Type", "application/json; charset=utf-8");
        request.onreadystatechange = () => {
            if (request.readyState === XMLHttpRequest.DONE)
                return request.status >= 200 && request.status < 300
                    ? resolve(JSON.parse(request.responseText))
                    : reject(JSON.parse(request.responseText));
        };
        request.send(JSON.stringify(data));
    })
};
const wait = (time = 500) => new Promise(resolve => setTimeout(() => resolve(), time));

const serverCost = {amount: 11, currency: 'EUR'};

const symbolCall = Ajax.get('https://fixer-middle-endpoint.azurewebsites.net/api/symbols');
const ratesCall = Ajax.get('https://fixer-middle-endpoint.azurewebsites.net/api/rates');

const donationUrl = 'http://localhost:3000/api/donation';
// 'https://fixer-middle-endpoint.azurewebsites.net/api/donation';

window.addEventListener('load', async () => {
    const symbols = (await symbolCall).symbols;
    const rates = (await ratesCall).rates;

    document.getElementById('currency').innerHTML = Object.keys(symbols).sort().map(tag => `<option value="${tag}">${tag} (${symbols[tag]})</option>`).join('');

    const url_string = window.location.href;
    const url = new URL(url_string);
    const base = (url.searchParams.get("base") || 'EUR').toUpperCase();
    document.getElementById('currency').value = base;

    const error = document.getElementById('error');
    const success = document.getElementById('success');
    const loading = document.getElementById('loading');

    const updateCovers = () => {
        const amount = document.getElementById('amount').value;
        const currency = document.getElementById('currency').value;
        const actual = amount / rates[currency];
        let months = actual / serverCost.amount;

        let years = Math.floor(months / 12);
        let days = months * 30;
        let hours = days * 24;

        months = Math.floor(months - years * 12);
        days = Math.floor(days - months * 30);
        hours = Math.floor(hours - days * 24);

        let cover;
        if (years > 0) cover = `${years} year(s) and ${months} month(s)`;
        else if (months > 0) cover = `${months} month(s) and ${days} day(s)`;
        else if (days > 0) cover = `${days} day(s) and ${hours} hour(s)`;
        else cover = `${hours} hour(s)`;

        document.getElementById('covers').innerText = cover;
    };

    document.getElementById('amount').addEventListener('change', () => updateCovers());
    document.getElementById('currency').addEventListener('change', () => updateCovers());
    updateCovers();

    let canDonate = false;
    let donationId = null;
    document.getElementById('donate-button').addEventListener('click', async () => {
        error.innerText = '';
        success.innerText = '';
        document.getElementById('donate-button').classList.add('hidden');
        loading.classList.remove('hidden');
        donationId = (await Ajax.get(donationUrl)).id;
        loading.classList.add('hidden');
        document.getElementById('donate-sure').classList.remove('hidden');
        canDonate = true;
    });

    document.getElementById('donate-button-cancel').addEventListener('click', () => {
        canDonate = false;
        document.getElementById('donate-sure').classList.add('hidden');
        document.getElementById('donate-button').classList.remove('hidden');
    });

    document.getElementById('donate-button-final').addEventListener('click', async () => {
        if (!canDonate) return;
        canDonate = false;
        const amount = document.getElementById('amount').value - 0;
        const currency = document.getElementById('currency').value;
        const email = document.getElementById('email').value;
        document.getElementById('donate-sure').classList.add('hidden');
        loading.classList.remove('hidden');

        await Ajax.post(donationUrl, {
            amount: amount,
            email: email,
            currency: currency,
            id: donationId
        }).then(() => {
            error.innerText = '';
            success.innerHTML = `Thanks for your donation :)`;
        }).catch(err => {
            success.innerText = '';
            error.innerText = err.message;
        });

        loading.classList.add('hidden');
        document.getElementById('donate-button').classList.remove('hidden');
    });

});