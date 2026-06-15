START TRANSACTION;

CREATE TABLE IF NOT EXISTS `registro_detalles` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `registro_id` int(10) UNSIGNED NOT NULL,
  `tipo_mercaderia_id` int(10) UNSIGNED NOT NULL,
  `sku_id` int(10) UNSIGNED NOT NULL,
  `lote_id` int(10) UNSIGNED DEFAULT NULL,
  `fecha_vencimiento` date DEFAULT NULL,
  `cantidad` decimal(12,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_registro_detalle_registro` (`registro_id`),
  KEY `idx_registro_detalle_sku` (`sku_id`),
  KEY `idx_registro_detalle_lote` (`lote_id`),
  CONSTRAINT `fk_registro_detalle_registro` FOREIGN KEY (`registro_id`) REFERENCES `registros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_registro_detalle_tipo` FOREIGN KEY (`tipo_mercaderia_id`) REFERENCES `tipos_mercaderia` (`id`),
  CONSTRAINT `fk_registro_detalle_sku` FOREIGN KEY (`sku_id`) REFERENCES `skus` (`id`),
  CONSTRAINT `fk_registro_detalle_lote` FOREIGN KEY (`lote_id`) REFERENCES `lotes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `stock_almacen` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `empresa_id` int(10) UNSIGNED NOT NULL,
  `almacen_id` int(10) UNSIGNED NOT NULL,
  `sku_id` int(10) UNSIGNED NOT NULL,
  `lote_id` int(10) UNSIGNED DEFAULT NULL,
  `cantidad` decimal(14,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_almacen` (`empresa_id`,`almacen_id`,`sku_id`,`lote_id`),
  KEY `idx_stock_almacen_almacen` (`almacen_id`),
  KEY `idx_stock_almacen_sku` (`sku_id`),
  KEY `idx_stock_almacen_lote` (`lote_id`),
  CONSTRAINT `fk_stock_almacen_almacen` FOREIGN KEY (`almacen_id`) REFERENCES `almacenes` (`id`),
  CONSTRAINT `fk_stock_almacen_sku` FOREIGN KEY (`sku_id`) REFERENCES `skus` (`id`),
  CONSTRAINT `fk_stock_almacen_lote` FOREIGN KEY (`lote_id`) REFERENCES `lotes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `stock_movimientos` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `empresa_id` int(10) UNSIGNED NOT NULL,
  `registro_id` int(10) UNSIGNED NOT NULL,
  `registro_detalle_id` int(10) UNSIGNED DEFAULT NULL,
  `almacen_origen_id` int(10) UNSIGNED NOT NULL,
  `almacen_destino_id` int(10) UNSIGNED NOT NULL,
  `sku_id` int(10) UNSIGNED NOT NULL,
  `lote_id` int(10) UNSIGNED DEFAULT NULL,
  `cantidad` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tipo_movimiento` varchar(40) NOT NULL DEFAULT 'APROBACION',
  `usuario_id` int(10) UNSIGNED DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_stock_movimientos_registro` (`registro_id`),
  KEY `idx_stock_movimientos_detalle` (`registro_detalle_id`),
  KEY `idx_stock_movimientos_sku_lote` (`sku_id`,`lote_id`),
  CONSTRAINT `fk_stock_movimientos_registro` FOREIGN KEY (`registro_id`) REFERENCES `registros` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stock_movimientos_detalle` FOREIGN KEY (`registro_detalle_id`) REFERENCES `registro_detalles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_stock_movimientos_sku` FOREIGN KEY (`sku_id`) REFERENCES `skus` (`id`),
  CONSTRAINT `fk_stock_movimientos_lote` FOREIGN KEY (`lote_id`) REFERENCES `lotes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `personal_receptor`
  ADD KEY `idx_personal_receptor_almacen_categoria` (`almacen_id`,`categoria_id`);

ALTER TABLE `lotes`
  ADD UNIQUE KEY `uq_lote_sku_codigo` (`sku_id`,`codigo_lote`);

INSERT INTO `registro_detalles` (`registro_id`, `tipo_mercaderia_id`, `sku_id`, `lote_id`, `fecha_vencimiento`, `cantidad`)
SELECT
  r.id,
  r.tipo_mercaderia_id,
  r.sku_id,
  r.lote_id,
  COALESCE(r.fecha_vencimiento, l.fecha_vencimiento),
  r.cantidad
FROM `registros` r
LEFT JOIN `lotes` l ON l.id = r.lote_id
WHERE r.sku_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `registro_detalles` rd
    WHERE rd.registro_id = r.id
  );

INSERT INTO `stock_movimientos`
(`empresa_id`, `registro_id`, `registro_detalle_id`, `almacen_origen_id`, `almacen_destino_id`, `sku_id`, `lote_id`, `cantidad`, `tipo_movimiento`, `usuario_id`)
SELECT
  r.empresa_id,
  r.id,
  rd.id,
  r.almacen_origen_id,
  r.almacen_destino_id,
  rd.sku_id,
  rd.lote_id,
  rd.cantidad,
  'APROBACION',
  COALESCE(r.aprobado_por, r.usuario_id)
FROM `registros` r
JOIN `registro_detalles` rd ON rd.registro_id = r.id
WHERE r.estado = 'aprobado'
  AND r.almacen_destino_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `stock_movimientos` sm
    WHERE sm.registro_id = r.id
      AND (
        (sm.registro_detalle_id = rd.id)
        OR (sm.registro_detalle_id IS NULL AND rd.id IS NULL)
      )
  );

DELETE FROM `stock_almacen`;

INSERT INTO `stock_almacen` (`empresa_id`, `almacen_id`, `sku_id`, `lote_id`, `cantidad`)
SELECT
  movimientos.empresa_id,
  movimientos.almacen_id,
  movimientos.sku_id,
  movimientos.lote_id,
  SUM(movimientos.delta) AS cantidad
FROM (
  SELECT
    sm.empresa_id,
    sm.almacen_origen_id AS almacen_id,
    sm.sku_id,
    sm.lote_id,
    (sm.cantidad * -1) AS delta
  FROM `stock_movimientos` sm
  UNION ALL
  SELECT
    sm.empresa_id,
    sm.almacen_destino_id AS almacen_id,
    sm.sku_id,
    sm.lote_id,
    sm.cantidad AS delta
  FROM `stock_movimientos` sm
) movimientos
GROUP BY
  movimientos.empresa_id,
  movimientos.almacen_id,
  movimientos.sku_id,
  movimientos.lote_id
HAVING ABS(SUM(movimientos.delta)) > 0.000001;

COMMIT;
