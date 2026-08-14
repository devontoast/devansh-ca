/*
  ODS real Shopify cart integration (Storefront API).
  Drop-in replacement for the old localStorage-only mock cart.
  Requires: SHOPIFY_CONFIG.storefrontAccessToken to be filled in below
  (generate it in Shopify Admin -> Headless sales channel -> Create storefront).
*/

var SHOPIFY_CONFIG = {
  domain: 'm4x0gd-pv.myshopify.com', // shop.devansh.ca's underlying myshopify domain
  apiVersion: '2025-01',
  storefrontAccessToken: '8830f20b88d8c2e84fb1332398df8407'
};

(function () {
  var CART_ID_KEY = 'ods_shopify_cart_id';
  var currentCart = null; // { id, checkoutUrl, lines: [...], subtotal, currencyCode }

  function apiUrl() {
    return 'https://' + SHOPIFY_CONFIG.domain + '/api/' + SHOPIFY_CONFIG.apiVersion + '/graphql.json';
  }

  function storefrontFetch(query, variables) {
    return fetch(apiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': SHOPIFY_CONFIG.storefrontAccessToken
      },
      body: JSON.stringify({ query: query, variables: variables })
    }).then(function (res) { return res.json(); });
  }

  var CART_FIELDS = 'id checkoutUrl totalQuantity ' +
    'cost { subtotalAmount { amount currencyCode } } ' +
    'lines(first: 50) { edges { node { id quantity merchandise { ... on ProductVariant { id title price { amount currencyCode } product { title featuredImage { url } } } } } } }';

  function cartFromResponse(cartNode) {
    if (!cartNode) return null;
    var lines = cartNode.lines.edges.map(function (e) {
      var n = e.node;
      return {
        lineId: n.id,
        variantId: n.merchandise.id,
        name: n.merchandise.product.title,
        price: parseFloat(n.merchandise.price.amount),
        image: n.merchandise.product.featuredImage ? n.merchandise.product.featuredImage.url : '',
        qty: n.quantity
      };
    });
    return {
      id: cartNode.id,
      checkoutUrl: cartNode.checkoutUrl,
      lines: lines,
      subtotal: parseFloat(cartNode.cost.subtotalAmount.amount),
      currencyCode: cartNode.cost.subtotalAmount.currencyCode
    };
  }

  function createCart(lines) {
    var query = 'mutation cartCreate($input: CartInput) { cartCreate(input: $input) { cart { ' + CART_FIELDS + ' } userErrors { field message } } }';
    return storefrontFetch(query, { input: { lines: lines || [] } }).then(function (res) {
      var payload = res.data.cartCreate;
      if (payload.userErrors && payload.userErrors.length) {
        console.error('cartCreate errors', payload.userErrors);
      }
      currentCart = cartFromResponse(payload.cart);
      localStorage.setItem(CART_ID_KEY, currentCart.id);
      return currentCart;
    });
  }

  function fetchCart(id) {
    var query = 'query cart($id: ID!) { cart(id: $id) { ' + CART_FIELDS + ' } }';
    return storefrontFetch(query, { id: id }).then(function (res) {
      if (!res.data || !res.data.cart) return null;
      currentCart = cartFromResponse(res.data.cart);
      return currentCart;
    });
  }

  function getOrCreateCart() {
    var existingId = localStorage.getItem(CART_ID_KEY);
    if (currentCart) return Promise.resolve(currentCart);
    if (existingId) {
      return fetchCart(existingId).then(function (cart) {
        if (cart) return cart;
        localStorage.removeItem(CART_ID_KEY);
        return createCart([]);
      });
    }
    return createCart([]);
  }

  function linesAdd(cartId, merchandiseId, qty) {
    var query = 'mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ' + CART_FIELDS + ' } userErrors { field message } } }';
    return storefrontFetch(query, { cartId: cartId, lines: [{ merchandiseId: merchandiseId, quantity: qty }] }).then(function (res) {
      var payload = res.data.cartLinesAdd;
      if (payload.userErrors && payload.userErrors.length) console.error('cartLinesAdd errors', payload.userErrors);
      currentCart = cartFromResponse(payload.cart);
      return currentCart;
    });
  }

  function linesUpdate(cartId, lineId, qty) {
    var query = 'mutation cartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ' + CART_FIELDS + ' } userErrors { field message } } }';
    return storefrontFetch(query, { cartId: cartId, lines: [{ id: lineId, quantity: qty }] }).then(function (res) {
      var payload = res.data.cartLinesUpdate;
      if (payload.userErrors && payload.userErrors.length) console.error('cartLinesUpdate errors', payload.userErrors);
      currentCart = cartFromResponse(payload.cart);
      return currentCart;
    });
  }

  function linesRemove(cartId, lineId) {
    var query = 'mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) { cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ' + CART_FIELDS + ' } userErrors { field message } } }';
    return storefrontFetch(query, { cartId: cartId, lineIds: [lineId] }).then(function (res) {
      var payload = res.data.cartLinesRemove;
      if (payload.userErrors && payload.userErrors.length) console.error('cartLinesRemove errors', payload.userErrors);
      currentCart = cartFromResponse(payload.cart);
      return currentCart;
    });
  }

  // Public API — mirrors the old mock cart's function names so page code barely changes.
  // item = { id: '<Shopify variant GID>', name, price, image }
  window.addToCart = function (item) {
    getOrCreateCart().then(function (cart) {
      var existingLine = cart.lines.find(function (l) { return l.variantId === item.id; });
      var p = existingLine
        ? linesUpdate(cart.id, existingLine.lineId, existingLine.qty + 1)
        : linesAdd(cart.id, item.id, 1);
      p.then(function () { renderCart(); openCart(); }).catch(function (err) {
        console.error('addToCart failed', err);
        alert('Could not add to cart — check the Storefront API token in shopify-cart.js.');
      });
    });
  };

  window.removeFromCart = function (variantId) {
    if (!currentCart) return;
    var line = currentCart.lines.find(function (l) { return l.variantId === variantId; });
    if (!line) return;
    linesRemove(currentCart.id, line.lineId).then(renderCart);
  };

  window.setQty = function (variantId, qty) {
    if (!currentCart) return;
    var line = currentCart.lines.find(function (l) { return l.variantId === variantId; });
    if (!line) return;
    linesUpdate(currentCart.id, line.lineId, Math.max(1, qty)).then(renderCart);
  };

  function renderCart() {
    var countEl = document.getElementById('cart-count');
    var itemsWrap = document.getElementById('cart-items');
    var subtotalEl = document.getElementById('cart-subtotal');
    if (!countEl || !itemsWrap || !subtotalEl) return;

    var lines = currentCart ? currentCart.lines : [];
    var count = lines.reduce(function (sum, l) { return sum + l.qty; }, 0);
    countEl.textContent = count;

    if (lines.length === 0) {
      itemsWrap.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    } else {
      itemsWrap.innerHTML = lines.map(function (item) {
        return '<div class="cart-item"><div class="cart-item-image"><img src="' + item.image + '" alt="' + item.name + '"></div><div class="cart-item-info"><div class="cart-item-name">' + item.name + '</div><div class="cart-item-price">$' + item.price.toFixed(2) + ' CAD</div><div class="cart-item-controls"><button class="cart-qty-btn" data-action="dec" data-id="' + item.variantId + '">-</button><span>' + item.qty + '</span><button class="cart-qty-btn" data-action="inc" data-id="' + item.variantId + '">+</button><button class="cart-remove" data-action="remove" data-id="' + item.variantId + '">Remove</button></div></div></div>';
      }).join('');
    }
    subtotalEl.textContent = '$' + (currentCart ? currentCart.subtotal.toFixed(2) : '0.00') + ' CAD';

    itemsWrap.querySelectorAll('button[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        var line = currentCart.lines.find(function (l) { return l.variantId === id; });
        if (!line) return;
        if (action === 'remove') removeFromCart(id);
        else if (action === 'inc') setQty(id, line.qty + 1);
        else if (action === 'dec') setQty(id, line.qty - 1);
      });
    });
  }
  window.renderCart = renderCart;

  function openCart() {
    var d = document.getElementById('cart-drawer'), o = document.getElementById('cart-overlay');
    if (d) d.classList.add('active');
    if (o) o.classList.add('active');
  }
  window.openCart = openCart;

  function closeCart() {
    var d = document.getElementById('cart-drawer'), o = document.getElementById('cart-overlay');
    if (d) d.classList.remove('active');
    if (o) o.classList.remove('active');
  }
  window.closeCart = closeCart;

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('cart-toggle');
    var close = document.getElementById('cart-close');
    var overlay = document.getElementById('cart-overlay');
    var checkoutBtn = document.getElementById('cart-checkout-btn');
    if (toggle) toggle.addEventListener('click', openCart);
    if (close) close.addEventListener('click', closeCart);
    if (overlay) overlay.addEventListener('click', closeCart);
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', function () {
        if (currentCart && currentCart.checkoutUrl && currentCart.lines.length > 0) {
          window.location.href = currentCart.checkoutUrl;
        }
      });
    }
    getOrCreateCart().then(renderCart).catch(function (err) {
      console.error('Could not load cart', err);
    });
  });
})();
