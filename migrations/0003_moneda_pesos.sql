-- Coti cotiza en pesos argentinos: Mercado Pago cobra el monto exacto, sin conversión.
UPDATE workshops SET currency = 'ARS' WHERE currency = 'USD';
