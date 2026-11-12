-- Datos de ejemplo
INSERT IGNORE INTO categories (id, name, sort_order) VALUES
  (1, 'Cafés', 1), (2, 'Bebidas', 2), (3, 'Tapas', 3), (4, 'Bocadillos', 4);

INSERT IGNORE INTO products (id, category_id, name, price, tax_rate, stock) VALUES
  (1, 1, 'Café solo', 1.40, 10.00, NULL),
  (2, 1, 'Cortado', 1.50, 10.00, NULL),
  (3, 1, 'Café con leche', 1.70, 10.00, NULL),
  (4, 2, 'Caña', 2.20, 10.00, NULL),
  (5, 2, 'Agua 50cl', 1.50, 10.00, 48),
  (6, 2, 'Refresco', 2.40, 10.00, 60),
  (7, 2, 'Copa de vino', 3.00, 10.00, NULL),
  (8, 3, 'Bravas', 5.50, 10.00, NULL),
  (9, 3, 'Croquetas (6u)', 7.00, 10.00, NULL),
  (10, 3, 'Tortilla', 4.50, 10.00, NULL),
  (11, 4, 'Bocadillo de jamón', 6.00, 10.00, NULL),
  (12, 4, 'Bikini', 4.00, 10.00, NULL);
