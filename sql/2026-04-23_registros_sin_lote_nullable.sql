START TRANSACTION;

ALTER TABLE `registro_detalles`
  MODIFY `lote_id` int(10) UNSIGNED DEFAULT NULL,
  MODIFY `fecha_vencimiento` date DEFAULT NULL;

ALTER TABLE `stock_almacen`
  MODIFY `lote_id` int(10) UNSIGNED DEFAULT NULL;

ALTER TABLE `stock_movimientos`
  MODIFY `lote_id` int(10) UNSIGNED DEFAULT NULL;

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

COMMIT;
