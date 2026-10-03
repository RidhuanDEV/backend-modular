<?php

declare(strict_types=1);

namespace App\Providers;

use App\Infrastructure\Storage\LaravelStorage;
use App\Infrastructure\Storage\ObjectStorage;
use App\Modules\Auth\Services\Actor;
use App\Modules\Auth\Services\JwtService;
use App\Modules\Users\Models\User;
use App\Modules\Users\Policies\AccessPolicy;
use App\Support\Config\Settings;
use App\Support\Endpoint\EndpointRegistry;
use App\Support\Observability\EndpointDocumentation;
use App\Support\Observability\Telemetry;
use Dedoc\Scramble\Scramble;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        Scramble::ignoreDefaultRoutes();
        $this->app->bind(ObjectStorage::class, LaravelStorage::class);
        $this->app->scoped(Actor::class);
        $this->app->scoped(Telemetry::class);
        $this->app->singleton(EndpointRegistry::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Model::preventLazyLoading(! app()->isProduction());
        DB::listen(function (QueryExecuted $event): void {
            app(Telemetry::class)->measure('db.query', $event->time / 1000);
        });
        $this->loadMigrationsFrom(database_path('migrations/'.Settings::string('backend.provider')));
        Auth::viaRequest('backend-jwt', function (Request $request): ?User {
            $token = $request->bearerToken();
            if ($token === null) {
                return null;
            }
            $claims = app(JwtService::class)->verify($token);

            return User::query()->find($claims->userId);
        });
        Gate::define('backend.permission', fn (User $user, string $permission): bool => app(AccessPolicy::class)->permits($user, $permission));
        $documentation = Scramble::configure();
        $documentation->routes(fn (Route $route): bool => $route->getName() !== null);
        $documentation->withOperationTransformers(EndpointDocumentation::class);
        Scramble::throwOnError();
    }
}
