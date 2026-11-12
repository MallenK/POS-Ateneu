-- POS Ateneu · Esquema inicial (MySQL 8+)
-- Importes en DECIMAL(10,2). Los precios de producto son PVP (IVA incluido).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  category_id  INT UNSIGNED  NOT NULL,
  name         VARCHAR(120)  NOT NULL,
  price        DECIMAL(10,2) NOT NULL COMMENT 'PVP, IVA incluido',
  tax_rate     DECIMAL(5,2)  NOT NULL DEFAULT 10.00 COMMENT '% IVA',
  stock        INT           NULL COMMENT 'NULL = sin control de stock',
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_products_category (category_id, active),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT chk_products_price CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_registers (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  opened_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at       DATETIME      NULL,
  initial_amount  DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Fondo de caja',
  final_amount    DECIMAL(10,2) NULL COMMENT 'Efectivo contado en el arqueo',
  expected_amount DECIMAL(10,2) NULL COMMENT 'Fondo + ventas en efectivo',
  difference      DECIMAL(10,2) NULL COMMENT 'final_amount - expected_amount',
  status          ENUM('open','closed') NOT NULL DEFAULT 'open',
  -- Garantiza una única caja abierta: los NULL no colisionan en un índice UNIQUE.
  open_flag       TINYINT GENERATED ALWAYS AS (IF(status = 'open', 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_registers_single_open (open_flag),
  KEY idx_cash_registers_opened (opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nif          VARCHAR(20)  NOT NULL,
  name         VARCHAR(160) NOT NULL,
  address      VARCHAR(200) NULL,
  postal_code  VARCHAR(10)  NULL,
  city         VARCHAR(80)  NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_nif (nif)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contador correlativo por serie. Se bloquea con SELECT ... FOR UPDATE al emitir.
CREATE TABLE IF NOT EXISTS invoice_series (
  series       VARCHAR(10)  NOT NULL,
  next_number  INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (series)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cash_register_id  INT UNSIGNED    NOT NULL,
  table_number      VARCHAR(10)     NULL,
  customer_id       INT UNSIGNED    NULL,
  invoice_type      ENUM('simplified','full') NOT NULL DEFAULT 'simplified',
  -- Serie y número se asignan al cobrar por completo (numeración sin huecos).
  series            VARCHAR(10)     NULL,
  number            INT UNSIGNED    NULL,
  total_amount      DECIMAL(10,2)   NOT NULL,
  payment_method    ENUM('cash','card','mixed') NULL,
  status            ENUM('open','paid','cancelled') NOT NULL DEFAULT 'open',
  verifacti_status  ENUM('not_sent','pending','sent','rejected') NOT NULL DEFAULT 'not_sent',
  verifacti_uuid    VARCHAR(64)     NULL,
  qr_data           MEDIUMTEXT      NULL COMMENT 'QR devuelto por Verifacti',
  qr_url            VARCHAR(500)    NULL,
  hash              VARCHAR(128)    NULL COMMENT 'Huella del registro de facturación',
  verifacti_error   VARCHAR(500)    NULL,
  issued_at         DATETIME        NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_series_number (series, number),
  KEY idx_tickets_register (cash_register_id, status),
  KEY idx_tickets_open_tables (status, table_number),
  KEY idx_tickets_verifacti (verifacti_status),
  KEY idx_tickets_created (created_at),
  CONSTRAINT fk_tickets_register FOREIGN KEY (cash_register_id) REFERENCES cash_registers (id),
  CONSTRAINT fk_tickets_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id     BIGINT UNSIGNED NOT NULL,
  product_id    INT UNSIGNED    NOT NULL,
  -- Copia de nombre e IVA en el momento de la venta: el ticket no cambia si se edita el producto.
  product_name  VARCHAR(120)    NOT NULL,
  quantity      INT UNSIGNED    NOT NULL,
  unit_price    DECIMAL(10,2)   NOT NULL,
  tax_rate      DECIMAL(5,2)    NOT NULL,
  subtotal      DECIMAL(10,2)   NOT NULL COMMENT 'quantity * unit_price, IVA incluido',
  PRIMARY KEY (id),
  KEY idx_ticket_items_ticket (ticket_id),
  KEY idx_ticket_items_product (product_id),
  CONSTRAINT fk_ticket_items_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id),
  CONSTRAINT fk_ticket_items_product FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un ticket puede cobrarse en varios pagos (división de cuenta / cobro parcial).
CREATE TABLE IF NOT EXISTS payments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id         BIGINT UNSIGNED NOT NULL,
  cash_register_id  INT UNSIGNED    NOT NULL,
  method            ENUM('cash','card') NOT NULL,
  amount            DECIMAL(10,2)   NOT NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payments_ticket (ticket_id),
  KEY idx_payments_register_method (cash_register_id, method),
  CONSTRAINT fk_payments_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id),
  CONSTRAINT fk_payments_register FOREIGN KEY (cash_register_id) REFERENCES cash_registers (id),
  CONSTRAINT chk_payments_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cola de envío a Verifacti (fallback offline + reintentos).
CREATE TABLE IF NOT EXISTS verifacti_queue (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id        BIGINT UNSIGNED NOT NULL,
  payload          JSON            NOT NULL,
  idempotency_key  VARCHAR(64)     NOT NULL,
  status           ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  attempts         INT UNSIGNED    NOT NULL DEFAULT 0,
  next_attempt_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error       VARCHAR(500)    NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_verifacti_queue_ticket (ticket_id),
  KEY idx_verifacti_queue_due (status, next_attempt_at),
  CONSTRAINT fk_verifacti_queue_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
