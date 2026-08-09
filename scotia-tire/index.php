<?php
/**
 * Main fallback template — blog index, archives, search.
 *
 * @package Scotia_Tire
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();
?>

<main id="primary" class="st-main">
	<div class="st-container">

		<div class="st-page-title">
			<h1>
				<?php
				if ( is_home() && ! is_front_page() ) {
					single_post_title();
				} elseif ( is_search() ) {
					/* translators: %s: search query. */
					printf( esc_html__( 'Search: %s', 'scotia-tire' ), '<span class="accent">' . esc_html( get_search_query() ) . '</span>' );
				} elseif ( is_archive() ) {
					the_archive_title();
				} else {
					esc_html_e( 'Latest News', 'scotia-tire' );
				}
				?>
			</h1>
			<?php if ( is_archive() && get_the_archive_description() ) : ?>
				<div class="st-sub"><?php the_archive_description(); ?></div>
			<?php endif; ?>
		</div>

		<?php if ( have_posts() ) : ?>

			<div class="st-entry">
				<?php while ( have_posts() ) : ?>
					<?php the_post(); ?>
					<article id="post-<?php the_ID(); ?>" <?php post_class( 'st-post' ); ?>>
						<div class="st-post__meta"><?php echo esc_html( get_the_date() ); ?></div>
						<h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
						<?php if ( has_post_thumbnail() ) : ?>
							<a href="<?php the_permalink(); ?>"><?php the_post_thumbnail( 'large' ); ?></a>
						<?php endif; ?>
						<div class="st-post__content"><?php the_excerpt(); ?></div>
						<a class="st-btn st-btn--ghost" href="<?php the_permalink(); ?>"><?php esc_html_e( 'Read More', 'scotia-tire' ); ?></a>
					</article>
				<?php endwhile; ?>
			</div>

			<nav class="st-pagination" aria-label="<?php esc_attr_e( 'Posts navigation', 'scotia-tire' ); ?>">
				<?php echo wp_kses_post( paginate_links( array( 'type' => 'plain' ) ) ); ?>
			</nav>

		<?php else : ?>

			<div class="st-entry">
				<p><?php esc_html_e( 'Nothing found here. Try a search, or head back to the front page.', 'scotia-tire' ); ?></p>
				<?php get_search_form(); ?>
			</div>

		<?php endif; ?>

	</div>
</main>

<?php
get_footer();
