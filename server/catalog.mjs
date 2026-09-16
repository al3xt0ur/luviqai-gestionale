// Eseguito solo durante la migrazione o l'importazione di dati precedenti al catalogo.
// Ricava le offerte dai pacchetti esistenti, senza imporre tagli alle nuove imprese.
export async function importPackageCatalog(tx) {
  await tx.query(`WITH variants AS (
    SELECT DISTINCT tenant_id,tier,original,rule FROM packages p
    WHERE NOT EXISTS (SELECT 1 FROM package_templates t WHERE t.tenant_id=p.tenant_id)
  ), numbered AS (
    SELECT *,row_number() OVER(PARTITION BY tenant_id ORDER BY tier,original,rule)::integer AS id,
      count(*) OVER(PARTITION BY tenant_id,tier) AS variants FROM variants
  ), created AS (INSERT INTO package_templates(tenant_id,id,name,minutes,rule)
    SELECT tenant_id,id,CASE WHEN variants>1 THEN tier||' · '||original||' min · '||
      CASE WHEN rule='team' THEN 'squadra' ELSE 'operatore' END ELSE tier END,original,rule FROM numbered
    RETURNING tenant_id,id
  ) UPDATE packages p SET template_id=c.id,template_revision=1
    FROM numbered n JOIN created c ON c.tenant_id=n.tenant_id AND c.id=n.id
    WHERE p.tenant_id=n.tenant_id AND p.tier=n.tier AND p.original=n.original AND p.rule=n.rule AND p.template_id IS NULL`);
}
