<?php
/**
 * WooCommerce wrapper template.
 *
 * The opening/closing layout markup comes from the theme's
 * woocommerce_before_main_content / woocommerce_after_main_content
 * hooks registered in functions.php.
 *
 * @package Hotbox_Office
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();

woocommerce_content();

get_footer();
