<?php
// Synthetic products owned by this local test environment. No external content.
if (!defined('WP_CLI') || !WP_CLI || home_url() !== 'http://127.0.0.1:8088') {
    throw new RuntimeException('This seed is restricted to the local WooCommerce demo.');
}
update_option('woocommerce_currency', 'USD');
update_option('woocommerce_price_num_decimals', 2);
update_option('woocommerce_calc_taxes', 'no');
update_option('blog_public', '0');
$fixtures = [
    ['sku' => 'DEALFINDER-LOCAL-001', 'name' => 'LOCAL TEST Demo Headphones', 'regular' => '129.99', 'sale' => '99.99', 'stock' => 'instock'],
    ['sku' => 'DEALFINDER-LOCAL-002', 'name' => 'LOCAL TEST Demo Cable', 'regular' => '20.00', 'sale' => '15.00', 'stock' => 'instock'],
    ['sku' => 'DEALFINDER-LOCAL-003', 'name' => 'LOCAL TEST Demo Notebook', 'regular' => '8.50', 'sale' => '', 'stock' => 'outofstock'],
];
foreach ($fixtures as $fixture) {
    $id = wc_get_product_id_by_sku($fixture['sku']);
    $product = $id ? wc_get_product($id) : new WC_Product_Simple();
    $product->set_name($fixture['name']);
    $product->set_sku($fixture['sku']);
    $product->set_status('publish');
    $product->set_catalog_visibility('visible');
    $product->set_short_description('Synthetic local test product. Not a real commercial offer.');
    $product->set_regular_price($fixture['regular']);
    $product->set_sale_price($fixture['sale']);
    $product->set_price($fixture['sale'] !== '' ? $fixture['sale'] : $fixture['regular']);
    $product->set_stock_status($fixture['stock']);
    $product->save();
}
WP_CLI::success('Three LOCAL TEST products prepared without external images.');
