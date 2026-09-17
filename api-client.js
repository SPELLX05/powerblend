(function () {
  'use strict';

  const API_BASE = '/api';

  async function request(path, options) {
    const user = JSON.parse(localStorage.getItem('powerblendUser') || 'null');
    const adminToken = sessionStorage.getItem('powerblendAdminToken');
    const token = path.indexOf('/admin/') === 0 ? adminToken : user && user.token;
    const response = await fetch(API_BASE + path, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'The request could not be completed.');
    }
    return payload;
  }

  window.PowerblendAPI = {
    request,
    async submitBooking(data) {
      return request('/bookings', { method: 'POST', body: JSON.stringify(data) });
    },
    async submitMembership(data) {
      return request('/memberships', { method: 'POST', body: JSON.stringify(data) });
    },
    async submitOrder(data) {
      return request('/orders', { method: 'POST', body: JSON.stringify(data) });
    },
    async signup(data) {
      return request('/auth/signup', { method: 'POST', body: JSON.stringify(data) });
    },
    async login(data) {
      return request('/auth/login', { method: 'POST', body: JSON.stringify(data) });
    },
    async adminLogin(data) {
      const result = await request('/admin/login', { method: 'POST', body: JSON.stringify(data) });
      if (result.token) sessionStorage.setItem('powerblendAdminToken', result.token);
      return result;
    }
  };
}());
